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
    language TEXT DEFAULT 'en_us'
  )
`);

// Helper function to save guild config to SQLite
function saveGuildConfig(guildId, config) {
  const stmt = db.prepare(`
    INSERT INTO guilds (guild_id, server_name, afk_channel_id, afk_channel_name, allowed_roles, language)
    VALUES (@guildId, @serverName, @afkChannelId, @afkChannelName, @allowedRoles, @language)
    ON CONFLICT(guild_id) DO UPDATE SET
      server_name = @serverName,
      afk_channel_id = @afkChannelId,
      afk_channel_name = @afkChannelName,
      allowed_roles = @allowedRoles,
      language = @language
  `);
  stmt.run({
    guildId,
    serverName: config.serverName,
    afkChannelId: config.afkChannelId,
    afkChannelName: config.afkChannelName,
    allowedRoles: JSON.stringify(config.allowedRoles),
    language: config.language,
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
        ],
      },
    ];

    await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands });

    console.log("Slash commands registered successfully!");
  } catch (error) {
    console.error("Error registering commands:", error);
  }
})();

// Handle voice state updates to move users to AFK channel and disconnect if necessary
client.on("voiceStateUpdate", async (oldState, newState) => {
  try {
    const guildConfig = getGuildConfig(newState.guild.id);
    if (!guildConfig || !guildConfig.afkChannelId) return;

    const afkChannelId = guildConfig.afkChannelId;

    // Check if the user joined the configured AFK channel
    if (newState.channelId === afkChannelId) {
      if (newState.member.id === client.user.id) return; // Ignore the bot itself

      // Check bot permissions in the channel
      const botPermissions = newState.channel.permissionsFor(
        newState.guild.members.me
      );
      if (!botPermissions.has(PermissionsBitField.Flags.MoveMembers)) {
        console.error(t(newState.guild.id, "bot_move_permission_missing"));
        return;
      }

      // Disconnect the user
      await newState.disconnect();
    }

    // Check if the user is in a voice channel, muted, and deafened for more than 5 minutes
    if (
      newState.channelId &&
      newState.channelId !== afkChannelId &&
      newState.selfMute &&
      newState.selfDeaf
    ) {
      setTimeout(async () => {
        const member = await newState.guild.members.fetch(newState.id);
        if (
          member.voice.channelId === newState.channelId &&
          member.voice.selfMute &&
          member.voice.selfDeaf
        ) {
          // Move user to AFK channel
          await member.voice.setChannel(afkChannelId);
        }
      }, 5 * 60 * 1000); // 5 minutes in milliseconds
    }
  } catch (error) {
    console.error(t(newState.guild.id, "error_voice_state_update"), error);
  }
});

client.login(BOT_TOKEN);
