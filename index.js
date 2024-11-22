const fs = require("fs");
const path = require("path");
const {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  EmbedBuilder,
  PermissionsBitField,
  ActivityType,
} = require("discord.js");
const Database = require("better-sqlite3");
require("dotenv").config();

// Environment variables
const BOT_TOKEN = process.env.BOT_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;

// SQLite database setup
const db = new Database("server_config.db");
db.exec(`
  CREATE TABLE IF NOT EXISTS guilds (
    guild_id TEXT PRIMARY KEY,
    server_name TEXT,
    afk_channel_id TEXT,
    afk_channel_name TEXT,
    allowed_roles TEXT,
    language TEXT DEFAULT 'en_us',
    afk_timeout INTEGER DEFAULT 5
  )
`);

// Helper function to save guild config to SQLite
function saveGuildConfig(guildId, config) {
  const stmt = db.prepare(`
    INSERT INTO guilds (guild_id, server_name, afk_channel_id, afk_channel_name, allowed_roles, language, afk_timeout)
    VALUES (@guildId, @serverName, @afkChannelId, @afkChannelName, @allowedRoles, @language, @afkTimeout)
    ON CONFLICT(guild_id) DO UPDATE SET
      server_name = @serverName,
      afk_channel_id = @afkChannelId,
      afk_channel_name = @afkChannelName,
      allowed_roles = @allowedRoles,
      language = @language,
      afk_timeout = @afkTimeout
  `);
  stmt.run({
    guildId,
    serverName: config.serverName,
    afkChannelId: config.afkChannelId,
    afkChannelName: config.afkChannelName,
    allowedRoles: JSON.stringify(config.allowedRoles),
    language: config.language,
    afkTimeout: config.afkTimeout,
  });
}

// Helper function to get guild config from SQLite
function getGuildConfig(guildId) {
  const stmt = db.prepare("SELECT * FROM guilds WHERE guild_id = ?");
  const row = stmt.get(guildId);
  if (row) {
    return {
      serverName: row.server_name,
      afkChannelId: row.afk_channel_id,
      afkChannelName: row.afk_channel_name,
      allowedRoles: JSON.parse(row.allowed_roles),
      language: row.language,
      afkTimeout: row.afk_timeout,
    };
  }
  return null;
}

// Load translations from the translations directory
const TRANSLATIONS_DIR = "./translations";
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

// Translation helper function
function t(guildId, key, placeholders = {}) {
  const lang = getGuildConfig(guildId)?.language || "en_us";
  let text = translations[lang]?.[key] || translations["en_us"]?.[key] || key;

  for (const [placeholder, value] of Object.entries(placeholders)) {
    text = text.replace(`{${placeholder}}`, value);
  }

  return text;
}

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates],
});

client.once("ready", () => {
  console.log(`Bot is running as ${client.user.tag}`);
  updateServerData(); // Perform the first update immediately
  setInterval(updateServerData, 5 * 60 * 1000); // Update every 5 minutes

  // Set bot activity to show it is listening to /setup
  client.user.setActivity("/setup", { type: ActivityType.Listening });
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

// Register slash commands
const rest = new REST({ version: "10" }).setToken(BOT_TOKEN);

(async () => {
  try {
    console.log("Registering slash commands...");

    const commands = [
      {
        name: "setup",
        description: t(null, "setup_description"),
        options: [
          {
            name: "channel",
            description: t(null, "setup_channel_description"),
            type: 3, // STRING
            required: true,
          },
          {
            name: "roles",
            description: t(null, "setup_roles_description"),
            type: 3, // STRING
            required: true,
          },
          {
            name: "language",
            description: t(null, "setup_language_description"),
            type: 3, // STRING
            required: true,
          },
          {
            name: "afk_timeout",
            description: t(null, "setup_afk_timeout_description"),
            type: 3, // STRING
            required: true,
            choices: [
              { name: "1 minute", value: "1" },
              { name: "5 minutes", value: "5" },
              { name: "15 minutes", value: "15" },
              { name: "30 minutes", value: "30" },
              { name: "1 hour", value: "60" },
            ],
          },
        ],
      },
      {
        name: "afkinfo",
        description: t(null, "afkinfo_description"),
      },
      {
        name: "setafk",
        description: t(null, "setafk_description"),
        options: [
          {
            name: "channel",
            description: t(null, "setafk_channel_description"),
            type: 3, // STRING
            required: true,
          },
        ],
      },
      {
        name: "setroles",
        description: t(null, "setroles_description"),
        options: [
          {
            name: "roles",
            description: t(null, "setroles_roles_description"),
            type: 3, // STRING
            required: true,
          },
        ],
      },
      {
        name: "setlang",
        description: t(null, "setlang_description"),
        options: [
          {
            name: "language",
            description: t(null, "setlang_language_description"),
            type: 3, // STRING
            required: false,
          },
        ],
      },
      {
        name: "afklimit",
        description: t(null, "afklimit_description"),
        options: [
          {
            name: "afk_timeout",
            description: t(null, "afklimit_afk_timeout_description"),
            type: 3, // STRING
            required: false,
            choices: [
              { name: "1 minute", value: "1" },
              { name: "5 minutes", value: "5" },
              { name: "15 minutes", value: "15" },
              { name: "30 minutes", value: "30" },
              { name: "1 hour", value: "60" },
            ],
          },
        ],
      },
    ];

    await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands });

    console.log("Slash commands registered successfully!");
  } catch (error) {
    console.error("Error registering commands:", error);
  }
})();

// Helper function to find a voice channel by name or ID
function findVoiceChannel(guild, input) {
  return guild.channels.cache.find(
    (channel) =>
      channel.type === 2 && // Ensure it's a voice channel
      (channel.name.toLowerCase() === input.toLowerCase() ||
        channel.id === input)
  );
}

// Helper function to find roles with "Administrator" permission
function findAdminRoles(guild) {
  return guild.roles.cache
    .filter(
      (role) =>
        role.permissions.has(PermissionsBitField.Flags.Administrator) &&
        !role.managed
    )
    .map((role) => ({ id: role.id, name: role.name }));
}

// Periodically update server data, including default admin roles and native AFK channel
async function updateServerData() {
  client.guilds.cache.forEach(async (guild) => {
    try {
      const guildConfig = getGuildConfig(guild.id) || {};
      guildConfig.serverName = guild.name;

      // Detect admin roles
      const adminRoles = findAdminRoles(guild);
      guildConfig.allowedRoles = adminRoles;

      // Detect preferred locale for language
      const locale = guild.preferredLocale.toLowerCase().replace("-", "_"); // Convert pt-BR to pt_br
      if (translations[locale]) {
        guildConfig.language = locale;
      } else {
        guildConfig.language = "en_us"; // Default to en_us
      }

      // Check native AFK channel
      const afkChannelId = guild.afkChannelId;
      if (afkChannelId) {
        const afkChannel = guild.channels.cache.get(afkChannelId);
        if (afkChannel) {
          guildConfig.afkChannelId = afkChannel.id;
          guildConfig.afkChannelName = afkChannel.name;
        }
      }

      // Save updated config
      saveGuildConfig(guild.id, guildConfig);
    } catch (error) {
      console.error(`Error updating server data for guild ${guild.id}:`, error);
    }
  });

  console.log(t(null, "server_data_updated", { time: getBrasiliaTime() }));
}

// Track voice states to manage AFK channel behavior
client.on("voiceStateUpdate", async (oldState, newState) => {
  try {
    const guildConfig = getGuildConfig(newState.guild.id);
    if (!guildConfig || !guildConfig.afkChannelId) return;

    const afkChannelId = guildConfig.afkChannelId;
    const afkTimeout = guildConfig.afkTimeout * 60 * 1000;

    // Check if the user joined the configured AFK channel
    if (newState.channelId === afkChannelId) {
      if (newState.member.id === client.user.id) return; // Ignore the bot itself

      // Check bot permissions in the channel
      const botPermissions = newState.channel.permissionsFor(
        newState.guild.members.me
      );
      if (!botPermissions.has(PermissionsBitField.Flags.MoveMembers)) {
        return;
      }

      // Disconnect the user
      await newState.disconnect();
    }

    // Check if a user is in a voice channel and muted for more than the configured timeout
    if (
      oldState.channelId !== afkChannelId &&
      newState.channelId &&
      newState.channelId !== afkChannelId &&
      newState.selfMute &&
      newState.selfDeaf
    ) {
      setTimeout(async () => {
        const currentState = newState.guild.members.cache.get(
          newState.id
        ).voice;
        if (
          currentState.channelId === newState.channelId &&
          currentState.selfMute &&
          currentState.selfDeaf
        ) {
          // Move user to AFK channel if still muted and deafened after the configured timeout
          await currentState.setChannel(afkChannelId);
        }
      }, afkTimeout); // Configured AFK timeout
    }
  } catch (error) {
    console.error(t(newState.guild.id, "error_voice_state_update"), error);
  }
});

// Handle /afkinfo command
client.on("interactionCreate", async (interaction) => {
  if (!interaction.isCommand()) return;

  const { commandName, guildId } = interaction;
  if (commandName === "afkinfo") {
    const guildConfig = getGuildConfig(guildId);
    if (!guildConfig) {
      return interaction.reply({
        content: t(guildId, "no_configuration"),
        ephemeral: true,
      });
    }

    const afkInfoEmbed = new EmbedBuilder()
      .setColor(0x0099ff)
      .setTitle(t(guildId, "afkinfo_title"))
      .addFields(
        {
          name: t(guildId, "afkinfo_channel"),
          value: guildConfig.afkChannelName || t(guildId, "afkinfo_not_set"),
          inline: true,
        },
        {
          name: t(guildId, "afkinfo_roles"),
          value: guildConfig.allowedRoles.length
            ? guildConfig.allowedRoles
                .map((role) => `<@&${role.id}>`)
                .join(", ")
            : t(guildId, "afkinfo_no_roles"),
          inline: true,
        },
        {
          name: t(guildId, "afkinfo_language"),
          value: guildConfig.language.toUpperCase(),
          inline: true,
        },
        {
          name: t(guildId, "afkinfo_timeout"),
          value: `${
            guildConfig.afkTimeout
              ? guildConfig.afkTimeout
              : t(guildId, "afkinfo_not_set")
          } minute(s)`,
          inline: true,
        }
      )
      .setFooter({ text: t(guildId, "afkinfo_footer") });

    return interaction.reply({ embeds: [afkInfoEmbed], ephemeral: true });
  }
});

client.login(BOT_TOKEN);
