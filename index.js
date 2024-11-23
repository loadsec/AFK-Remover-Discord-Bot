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

  // Merge new configuration with the existing one, ensuring existing values are retained if not overwritten
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
      server_name = COALESCE(NULLIF(@serverName, ''), guilds.server_name),
      afk_channel_id = COALESCE(NULLIF(@afkChannelId, ''), guilds.afk_channel_id),
      afk_channel_name = COALESCE(NULLIF(@afkChannelName, ''), guilds.afk_channel_name),
      allowed_roles = COALESCE(NULLIF(@allowedRoles, ''), guilds.allowed_roles),
      language = COALESCE(NULLIF(@language, ''), guilds.language),
      afk_timeout = COALESCE(@afkTimeout, guilds.afk_timeout)
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

// Handle /afkinfo and /afklimit commands
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
          value: guildConfig.afkTimeout
            ? t(guildId, "afk_timeout_minutes", {
                timeout: guildConfig.afkTimeout,
              })
            : t(guildId, "afkinfo_not_set"),
          inline: true,
        }
      )
      .setFooter({ text: t(guildId, "afkinfo_footer") });

    return interaction.reply({ embeds: [afkInfoEmbed], ephemeral: true });
  }

  if (commandName === "afklimit") {
    const afkTimeout = interaction.options.getString("afk_timeout");
    const guildConfig = getGuildConfig(guildId);
    if (!guildConfig) {
      return interaction.reply({
        content: t(guildId, "no_configuration"),
        ephemeral: true,
      });
    }

    // Update AFK timeout
    guildConfig.afkTimeout = parseInt(afkTimeout, 10);
    saveGuildConfig(guildId, guildConfig);

    return interaction.reply({
      content: t(guildId, "afk_timeout_updated", { timeout: afkTimeout }),
      ephemeral: true,
    });
  }

  if (commandName === "setlang") {
    const selectedLanguage = interaction.options.getString("language");

    // If no language is provided, show available languages
    if (!selectedLanguage) {
      const availableLanguages = Object.keys(translations)
        .map((lang) => lang.toUpperCase())
        .join(", ");
      const availableLanguagesEmbed = new EmbedBuilder()
        .setColor(0x0099ff)
        .setTitle(t(guildId, "available_languages_title"))
        .setDescription(availableLanguages)
        .setFooter({ text: t(guildId, "available_languages_footer") })
        .setTimestamp();

      return interaction.reply({
        embeds: [availableLanguagesEmbed],
        ephemeral: true,
      });
    }

    // Validate language
    if (!translations[selectedLanguage]) {
      const availableLanguages = Object.keys(translations)
        .map((lang) => lang.toUpperCase())
        .join(", ");
      const invalidLanguageEmbed = new EmbedBuilder()
        .setColor(0xffa500)
        .setTitle(t(guildId, "invalid_language_title"))
        .setDescription(
          `${t(guildId, "invalid_language")}

**${t(guildId, "available_languages_label")}:**
${availableLanguages}`
        )
        .setFooter({ text: t(guildId, "invalid_language_footer") });

      return interaction.reply({
        embeds: [invalidLanguageEmbed],
        ephemeral: true,
      });
    }

    // Update language in configuration
    const guildConfig = getGuildConfig(guildId) || {};
    guildConfig.language = selectedLanguage;
    saveGuildConfig(guildId, guildConfig);

    const languageSetEmbed = new EmbedBuilder()
      .setColor(0x00ff00)
      .setTitle(t(guildId, "language_set_title"))
      .setDescription(
        t(guildId, "language_set", {
          language: selectedLanguage.toUpperCase(),
        })
      )
      .setFooter({ text: t(guildId, "language_set_success_footer") });

    return interaction.reply({
      embeds: [languageSetEmbed],
      ephemeral: true,
    });
  }
});

client.login(BOT_TOKEN);
