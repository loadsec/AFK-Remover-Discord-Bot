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
  const existingConfig = getGuildConfig(guildId) || {};

  // Merge new configuration with the existing one
  const updatedConfig = {
    serverName: config.serverName || existingConfig.serverName,
    afkChannelId: config.afkChannelId || existingConfig.afkChannelId,
    afkChannelName: config.afkChannelName || existingConfig.afkChannelName,
    allowedRoles: config.allowedRoles
      ? JSON.stringify(config.allowedRoles)
      : existingConfig.allowedRoles,
    language: config.language || existingConfig.language || "en_us",
    afkTimeout:
      config.afkTimeout !== undefined
        ? config.afkTimeout
        : existingConfig.afkTimeout || 5,
  };

  const stmt = db.prepare(`
    INSERT INTO guilds (guild_id, server_name, afk_channel_id, afk_channel_name, allowed_roles, language, afk_timeout)
    VALUES (@guildId, @serverName, @afkChannelId, @afkChannelName, @allowedRoles, @language, @afkTimeout)
    ON CONFLICT(guild_id) DO UPDATE SET
      server_name = excluded.server_name,
      afk_channel_id = excluded.afk_channel_id,
      afk_channel_name = excluded.afk_channel_name,
      allowed_roles = excluded.allowed_roles,
      language = excluded.language,
      afk_timeout = excluded.afk_timeout
  `);

  stmt.run({
    guildId,
    ...updatedConfig,
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
      allowedRoles: row.allowed_roles ? JSON.parse(row.allowed_roles) : [],
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
  client.user.setActivity("/setup", { type: ActivityType.Listening });
});

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
            description: "Set the AFK channel.",
            type: 3, // STRING
            required: true,
          },
          {
            name: "roles",
            description: "Set the roles allowed to configure the bot.",
            type: 3, // STRING
            required: true,
          },
          {
            name: "language",
            description: "Set the language for the bot.",
            type: 3, // STRING
            required: true,
          },
          {
            name: "afk_timeout",
            description: "Set the AFK timeout in minutes.",
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
        description:
          "Displays the current AFK channel, roles, timeout, and language configuration.",
      },
      {
        name: "setafk",
        description: "Set the AFK channel for the bot.",
        options: [
          {
            name: "channel",
            description: "The voice channel to set as AFK.",
            type: 3, // STRING
            required: true,
          },
        ],
      },
      {
        name: "setroles",
        description: "Set the roles allowed to configure the bot.",
        options: [
          {
            name: "roles",
            description: "The roles to be allowed (comma-separated).",
            type: 3, // STRING
            required: true,
          },
        ],
      },
      {
        name: "setlang",
        description: "Set the language for the bot.",
        options: [
          {
            name: "language",
            description: "The language to set for the bot.",
            type: 3, // STRING
            required: true,
          },
        ],
      },
      {
        name: "afklimit",
        description:
          "Displays and updates the current AFK timeout setting for users.",
        options: [
          {
            name: "afk_timeout",
            description: "The AFK timeout in minutes.",
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
    ];

    await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands });

    console.log("Slash commands registered successfully!");
  } catch (error) {
    console.error("Error registering commands:", error);
  }
})();

// Handle interaction commands
client.on("interactionCreate", async (interaction) => {
  if (!interaction.isCommand()) return;

  const { commandName, guildId } = interaction;

  if (commandName === "setup") {
    const channelInput = interaction.options.getString("channel");
    const rolesInput = interaction.options.getString("roles");
    const selectedLanguage = interaction.options.getString("language");
    const afkTimeout = interaction.options.getString("afk_timeout");

    const afkChannel = findVoiceChannel(interaction.guild, channelInput);
    if (!afkChannel) {
      return interaction.reply({
        content: "Invalid AFK channel.",
        ephemeral: true,
      });
    }

    const extraRoles = rolesInput
      .split(",")
      .map((r) => r.trim())
      .filter(
        (role) =>
          !!interaction.guild.roles.cache.find(
            (x) => x.name.toLowerCase() === role.toLowerCase()
          )
      );

    const config = {
      serverName: interaction.guild.name,
      afkChannelId: afkChannel.id,
      afkChannelName: afkChannel.name,
      allowedRoles: extraRoles.map((roleName) => {
        const role = interaction.guild.roles.cache.find(
          (r) => r.name.toLowerCase() === roleName.toLowerCase()
        );
        return role ? { id: role.id, name: role.name } : null;
      }),
      language: selectedLanguage,
      afkTimeout: parseInt(afkTimeout, 10),
    };

    saveGuildConfig(guildId, config);

    return interaction.reply({
      content: "Setup complete.",
      ephemeral: true,
    });
  }

  if (commandName === "afkinfo") {
    const guildConfig = getGuildConfig(guildId);
    if (!guildConfig) {
      return interaction.reply({
        content: "No configuration found.",
        ephemeral: true,
      });
    }

    const afkInfoEmbed = new EmbedBuilder()
      .setColor(0x0099ff)
      .setTitle("AFK Configuration")
      .addFields(
        {
          name: "AFK Channel",
          value: guildConfig.afkChannelName || "Not set",
          inline: true,
        },
        {
          name: "Allowed Roles",
          value: guildConfig.allowedRoles.length
            ? guildConfig.allowedRoles
                .map((role) => `<@&${role.id}>`)
                .join(", ")
            : "None",
          inline: true,
        },
        {
          name: "Language",
          value: guildConfig.language.toUpperCase(),
          inline: true,
        },
        {
          name: "AFK Timeout",
          value: `${guildConfig.afkTimeout} minute(s)`,
          inline: true,
        }
      );

    return interaction.reply({ embeds: [afkInfoEmbed], ephemeral: true });
  }

  if (commandName === "setafk") {
    const channelInput = interaction.options.getString("channel");
    const afkChannel = findVoiceChannel(interaction.guild, channelInput);

    if (!afkChannel) {
      return interaction.reply({
        content: "Invalid AFK channel.",
        ephemeral: true,
      });
    }

    const guildConfig = getGuildConfig(guildId) || {};
    guildConfig.afkChannelId = afkChannel.id;
    guildConfig.afkChannelName = afkChannel.name;
    saveGuildConfig(guildId, guildConfig);

    return interaction.reply({
      content: `AFK channel set to ${afkChannel.name}`,
      ephemeral: true,
    });
  }

  if (commandName === "setlang") {
    const selectedLanguage = interaction.options.getString("language");

    if (!translations[selectedLanguage]) {
      return interaction.reply({
        content: "Invalid language selection.",
        ephemeral: true,
      });
    }

    const guildConfig = getGuildConfig(guildId) || {};
    guildConfig.language = selectedLanguage;
    saveGuildConfig(guildId, guildConfig);

    return interaction.reply({
      content: `Language set to ${selectedLanguage}`,
      ephemeral: true,
    });
  }

  if (commandName === "afklimit") {
    const afkTimeout = interaction.options.getString("afk_timeout");

    const guildConfig = getGuildConfig(guildId) || {};
    guildConfig.afkTimeout = parseInt(afkTimeout, 10);
    saveGuildConfig(guildId, guildConfig);

    return interaction.reply({
      content: `AFK timeout updated to ${afkTimeout} minute(s)`,
      ephemeral: true,
    });
  }

  if (commandName === "setroles") {
    const rolesInput = interaction.options.getString("roles");
    const extraRoles = rolesInput.split(",").map((r) => r.trim());

    const guildConfig = getGuildConfig(guildId) || {};
    guildConfig.allowedRoles = extraRoles.map((roleName) => {
      const role = interaction.guild.roles.cache.find(
        (r) => r.name.toLowerCase() === roleName.toLowerCase()
      );
      return role ? { id: role.id, name: role.name } : null;
    });

    saveGuildConfig(guildId, guildConfig);

    return interaction.reply({
      content: `Allowed roles updated.`,
      ephemeral: true,
    });
  }
});

// Helper function to find a voice channel by name or ID
function findVoiceChannel(guild, input) {
  return guild.channels.cache.find(
    (channel) =>
      channel.type === 2 && // Ensure it's a voice channel
      (channel.name.toLowerCase() === input.toLowerCase() ||
        channel.id === input)
  );
}

client.login(BOT_TOKEN);
