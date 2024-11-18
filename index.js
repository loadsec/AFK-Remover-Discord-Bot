const fs = require("fs");
const path = require("path");
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

// JSON files for configuration and translations
const CONFIG_FILE = "server_config.json";
const TRANSLATIONS_DIR = "./translations"; // Directory for translation files

// Helper functions for JSON manipulation
function loadJSON(file) {
  if (!fs.existsSync(file)) {
    fs.writeFileSync(file, JSON.stringify({}, null, 2), "utf8"); // Create file with empty object
  }
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function saveJSON(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2), "utf8");
}

let config = loadJSON(CONFIG_FILE);

// Load translations from the translations directory
const translations = {};
function loadTranslations() {
  const files = fs.readdirSync(TRANSLATIONS_DIR);
  for (const file of files) {
    if (file.endsWith(".json")) {
      const lang = path.basename(file, ".json").toLowerCase();
      translations[lang] = loadJSON(path.join(TRANSLATIONS_DIR, file));
    }
  }
}

loadTranslations();

// Translation helper function
function t(guildId, key, placeholders = {}) {
  const lang = config[guildId]?.language || "en_us"; // Default to en_us
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
        description: "Set up the AFK channel, roles, and language for the bot.",
        options: [
          {
            name: "channel",
            description: "The voice channel to set as AFK (name or ID).",
            type: 3, // STRING
            required: true,
          },
          {
            name: "roles",
            description:
              "Mention the roles allowed to configure the bot (comma-separated IDs or names).",
            type: 3, // STRING
            required: true,
          },
          {
            name: "language",
            description: "Select the language for this server.",
            type: 3, // STRING
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
      const guildConfig = config[guild.id] || {};
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
      config[guild.id] = guildConfig;
    } catch (error) {
      console.error(`Error updating server data for guild ${guild.id}:`, error);
    }
  });

  saveJSON(CONFIG_FILE, config);
  console.log(`Server data updated at ${getBrasiliaTime()}`);
}

// Handle interaction commands
client.on("interactionCreate", async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  const { commandName, options, guild, member } = interaction;

  // Verifica se o membro tem permissão para executar o comando
  const hasPermission = () => {
    const guildConfig = config[guild.id];
    if (!guildConfig) return false;

    // Verifica se o membro é administrador
    if (member.permissions.has(PermissionsBitField.Flags.Administrator))
      return true;

    // Verifica se o membro tem um dos cargos configurados
    if (guildConfig.allowedRoles?.length) {
      return guildConfig.allowedRoles.some((role) =>
        member.roles.cache.has(role.id)
      );
    }

    return false;
  };

  // Responde com erro se o usuário não tiver permissão
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

    // Find AFK channel
    const afkChannel = findVoiceChannel(guild, channelInput);
    if (!afkChannel) {
      return interaction.reply({
        content: t(guild.id, "invalid_channel"),
        ephemeral: true,
      });
    }

    // Find roles
    const roles = findAdminRoles(guild); // Add admin roles by default
    const extraRoles = rolesInput
      .split(",")
      .map((r) => r.trim())
      .filter(
        (role) =>
          !!guild.roles.cache.find(
            (x) => x.name.toLowerCase() === role.toLowerCase()
          )
      );

    // Save configuration
    config[guild.id] = {
      serverName: guild.name,
      afkChannelId: afkChannel.id,
      afkChannelName: afkChannel.name,
      allowedRoles: [...roles, ...extraRoles].map((role) => ({
        id: role.id,
        name: role.name,
      })),
      language: selectedLanguage,
    };

    saveJSON(CONFIG_FILE, config);

    return interaction.reply({
      content: t(guild.id, "setup_success", {
        channel: afkChannel.name,
        language: selectedLanguage.toUpperCase(),
      }),
      ephemeral: true,
    });
  }

  if (commandName === "afkinfo") {
    const guildConfig = config[guild.id];
    if (!guildConfig) {
      return interaction.reply({
        content: t(guild.id, "no_configuration"),
        ephemeral: true,
      });
    }

    // Create embed
    const embed = new EmbedBuilder()
      .setColor(0x0099ff)
      .setTitle(t(guild.id, "afkinfo_title"))
      .addFields(
        {
          name: t(guild.id, "afkinfo_channel"),
          value: guildConfig.afkChannelName || t(guild.id, "afkinfo_not_set"),
          inline: true,
        },
        {
          name: t(guild.id, "afkinfo_roles"),
          value: guildConfig.allowedRoles?.length
            ? guildConfig.allowedRoles
                .map((role) => `<@&${role.id}>`)
                .join(", ")
            : t(guild.id, "afkinfo_no_roles"),
          inline: true,
        },
        {
          name: t(guild.id, "afkinfo_language"),
          value: guildConfig.language?.toUpperCase() || "EN_US",
          inline: true,
        }
      )
      .setFooter({ text: t(guild.id, "afkinfo_footer") })
      .setTimestamp();

    return interaction.reply({ embeds: [embed], ephemeral: true });
  }
});

// Handle voice state updates to disconnect users from the AFK channel
client.on("voiceStateUpdate", async (oldState, newState) => {
  try {
    const guildConfig = config[newState.guild.id];
    if (!guildConfig || !guildConfig.afkChannelId) return;

    // Check if the user joined the configured AFK channel
    if (newState.channelId === guildConfig.afkChannelId) {
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
  } catch (error) {
    console.error("Error handling voice state update:", error);
  }
});

client.login(BOT_TOKEN);
