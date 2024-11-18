const fs = require("fs");
const path = require("path");
const sqlite3 = require("better-sqlite3");
const {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  EmbedBuilder,
  PermissionsBitField,
} = require("discord.js");
require("dotenv").config();

// Environment variables
const BOT_TOKEN = process.env.BOT_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;

// SQLite database setup
const db = new sqlite3("server_configs.db");

// Create the database table if it doesn't exist
db.prepare(
  `
  CREATE TABLE IF NOT EXISTS server_configs (
      server_id TEXT PRIMARY KEY,
      server_name TEXT,
      afk_channel_id TEXT,
      afk_channel_name TEXT,
      allowed_roles TEXT,
      language TEXT,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )
`
).run();

// Translation files
const TRANSLATIONS_DIR = "./translations";

// Load translations
const translations = {};
function loadTranslations() {
  const files = fs.readdirSync(TRANSLATIONS_DIR);
  for (const file of files) {
    if (file.endsWith(".json")) {
      const lang = path.basename(file, ".json").toLowerCase();
      translations[lang] = JSON.parse(
        fs.readFileSync(path.join(TRANSLATIONS_DIR, file), "utf8")
      );
    }
  }
}

loadTranslations();

// Translation helper
function t(serverId, key, placeholders = {}) {
  const serverConfig = getServerConfig(serverId);
  const lang = serverConfig?.language || "en_us"; // Default language
  let text = translations[lang]?.[key] || translations["en_us"]?.[key] || key;

  for (const [placeholder, value] of Object.entries(placeholders)) {
    text = text.replace(`{${placeholder}}`, value);
  }

  return text;
}

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates],
});

// Helper function to get the current time in Brasília (UTC-3)
function getBrasiliaTime() {
  const formatter = new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  return formatter.format(new Date());
}

// SQLite helpers
function getServerConfig(serverId) {
  return db
    .prepare("SELECT * FROM server_configs WHERE server_id = ?")
    .get(serverId);
}

function saveServerConfig(serverId, config) {
  db.prepare(
    `
    INSERT INTO server_configs (
      server_id, server_name, afk_channel_id, afk_channel_name, allowed_roles, language, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(server_id) DO UPDATE SET
      server_name = excluded.server_name,
      afk_channel_id = excluded.afk_channel_id,
      afk_channel_name = excluded.afk_channel_name,
      allowed_roles = excluded.allowed_roles,
      language = excluded.language,
      updated_at = CURRENT_TIMESTAMP
  `
  ).run(
    serverId,
    config.serverName,
    config.afkChannelId,
    config.afkChannelName,
    JSON.stringify(config.allowedRoles || []),
    config.language
  );
}

// Periodic update function
async function updateServerData() {
  client.guilds.cache.forEach(async (guild) => {
    const serverConfig = getServerConfig(guild.id) || {};
    serverConfig.serverName = guild.name;

    // Detect preferred locale for language
    const locale = guild.preferredLocale.toLowerCase().replace("-", "_");
    serverConfig.language = translations[locale] ? locale : "en_us";

    // Check native AFK channel
    if (guild.afkChannelId) {
      const afkChannel = guild.channels.cache.get(guild.afkChannelId);
      if (afkChannel) {
        serverConfig.afkChannelId = afkChannel.id;
        serverConfig.afkChannelName = afkChannel.name;
      }
    }

    // Save updated configuration
    saveServerConfig(guild.id, serverConfig);
  });

  console.log(`Server data updated at ${getBrasiliaTime()}`);
}

// Event listener for bot readiness
client.once("ready", () => {
  console.log(`Bot is running as ${client.user.tag}`);
  updateServerData(); // Perform the first update immediately
  setInterval(updateServerData, 5 * 60 * 1000); // Update every 5 minutes
});

// Slash commands registration
const rest = new REST({ version: "10" }).setToken(BOT_TOKEN);

(async () => {
  try {
    console.log("Registering slash commands...");

    const commands = [
      {
        name: "setup",
        description: "Set up the AFK channel, roles, and language for the bot.",
        options: [
          {
            name: "channel",
            description: "The voice channel to set as AFK (name or ID).",
            type: 3,
            required: true,
          },
          {
            name: "roles",
            description:
              "Mention the roles allowed to configure the bot (comma-separated IDs or names).",
            type: 3,
            required: true,
          },
          {
            name: "language",
            description: "Select the language for this server.",
            type: 3,
            required: true,
            choices: Object.keys(translations).map((lang) => ({
              name: lang.toUpperCase(),
              value: lang,
            })),
          },
        ],
      },
      {
        name: "afkinfo",
        description:
          "Displays the current AFK channel, roles, and language configuration.",
      },
    ];

    await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands });

    console.log("Slash commands registered successfully!");
  } catch (error) {
    console.error("Error registering commands:", error);
  }
})();

// Interaction handling
client.on("interactionCreate", async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  const { commandName, options, guild, member } = interaction;

  const hasPermission = () => {
    const serverConfig = getServerConfig(guild.id);
    if (!serverConfig) return false;

    if (member.permissions.has(PermissionsBitField.Flags.Administrator)) {
      return true;
    }

    const allowedRoles = JSON.parse(serverConfig.allowedRoles || "[]");
    return allowedRoles.some((role) => member.roles.cache.has(role.id));
  };

  if (!hasPermission()) {
    return interaction.reply({
      content: t(guild.id, "no_permission"),
      ephemeral: true,
    });
  }

  if (commandName === "setup") {
    const channelInput = options.getString("channel");
    const rolesInput = options.getString("roles");
    const selectedLanguage = options.getString("language");

    const afkChannel = guild.channels.cache.find(
      (channel) =>
        channel.type === 2 &&
        (channel.name.toLowerCase() === channelInput.toLowerCase() ||
          channel.id === channelInput)
    );

    if (!afkChannel) {
      return interaction.reply({
        content: t(guild.id, "invalid_channel"),
        ephemeral: true,
      });
    }

    const roles = rolesInput.split(",").map((role) => role.trim());
    const config = {
      serverName: guild.name,
      afkChannelId: afkChannel.id,
      afkChannelName: afkChannel.name,
      allowedRoles: roles.map((role) => ({ id: role.id, name: role.name })),
      language: selectedLanguage,
    };

    saveServerConfig(guild.id, config);

    return interaction.reply({
      content: t(guild.id, "setup_success", {
        channel: afkChannel.name,
        language: selectedLanguage.toUpperCase(),
      }),
      ephemeral: true,
    });
  }

  if (commandName === "afkinfo") {
    const serverConfig = getServerConfig(guild.id);
    if (!serverConfig) {
      return interaction.reply({
        content: t(guild.id, "no_configuration"),
        ephemeral: true,
      });
    }

    const embed = new EmbedBuilder()
      .setColor(0x0099ff)
      .setTitle(t(guild.id, "afkinfo_title"))
      .addFields(
        {
          name: t(guild.id, "afkinfo_channel"),
          value: serverConfig.afkChannelName || t(guild.id, "afkinfo_not_set"),
          inline: true,
        },
        {
          name: t(guild.id, "afkinfo_roles"),
          value:
            JSON.parse(serverConfig.allowedRoles || "[]")
              .map((role) => `<@&${role.id}>`)
              .join(", ") || t(guild.id, "afkinfo_no_roles"),
          inline: true,
        },
        {
          name: t(guild.id, "afkinfo_language"),
          value: serverConfig.language?.toUpperCase() || "EN_US",
          inline: true,
        }
      )
      .setFooter({ text: t(guild.id, "afkinfo_footer") })
      .setTimestamp();

    return interaction.reply({ embeds: [embed], ephemeral: true });
  }
});

// Voice state update handler
client.on("voiceStateUpdate", async (oldState, newState) => {
  try {
    const guildConfig = getServerConfig(newState.guild.id);
    if (!guildConfig || !guildConfig.afkChannelId) return;

    if (newState.channelId === guildConfig.afkChannelId) {
      if (newState.member.id === client.user.id) return;

      const botPermissions = newState.channel.permissionsFor(
        newState.guild.members.me
      );
      if (!botPermissions.has(PermissionsBitField.Flags.MoveMembers)) {
        console.warn(
          `Bot lacks 'Move Members' permission in the AFK channel for guild: ${newState.guild.id}`
        );
        return;
      }

      await newState.disconnect();
    }
  } catch (error) {
    console.error("Error handling voice state update:", error);
  }
});

client.login(BOT_TOKEN);
