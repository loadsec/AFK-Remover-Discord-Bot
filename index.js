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
      server_name = COALESCE(excluded.server_name, guilds.server_name),
      afk_channel_id = COALESCE(excluded.afk_channel_id, guilds.afk_channel_id),
      afk_channel_name = COALESCE(excluded.afk_channel_name, guilds.afk_channel_name),
      allowed_roles = COALESCE(excluded.allowed_roles, guilds.allowed_roles),
      language = COALESCE(excluded.language, guilds.language),
      afk_timeout = COALESCE(excluded.afk_timeout, guilds.afk_timeout)
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
  updateServerData(); // Perform the first update immediately
  setInterval(updateServerData, 5 * 60 * 1000); // Update every 5 minutes

  // Set bot activity to show it is listening to /afkinfo
  client.user.setActivity("/afkinfo", { type: ActivityType.Listening });
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

      // Set default AFK timeout if not set
      if (guildConfig.afkTimeout === undefined) {
        guildConfig.afkTimeout = 5; // Default timeout of 5 minutes if not set
      }

      // Save updated config
      saveGuildConfig(guild.id, guildConfig);
    } catch (error) {
      console.error(`Error updating server data for guild ${guild.id}:`, error);
    }
  });

  console.log(t(null, "server_data_updated", { time: getBrasiliaTime() }));
}

// Handle /afkinfo command
client.on("interactionCreate", async (interaction) => {
  if (!interaction.isCommand()) return;

  const { commandName, guildId } = interaction;

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
});

// Track voice states to manage AFK channel behavior
client.on("voiceStateUpdate", async (oldState, newState) => {
  try {
    const guildConfig = getGuildConfig(newState.guild.id);
    if (!guildConfig || !guildConfig.afkChannelId) return;

    const afkChannelId = guildConfig.afkChannelId;
    const afkTimeout = guildConfig.afkTimeout * 60 * 1000;

    // Check if a user is in a voice channel and muted/deafened for more than the configured timeout
    if (
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
    console.error(
      `Error handling voice state update for guild ${newState.guild.id}:`,
      error
    );
  }
});

client.login(BOT_TOKEN);
