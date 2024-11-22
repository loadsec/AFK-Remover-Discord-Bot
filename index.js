// Updated code to ensure members in the AFK channel are always disconnected and add new functionality to move muted and deafened members to the AFK channel after 5 minutes.

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
// Setting up a SQLite database to store guild (server) configuration information
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
// This function saves or updates the configuration of a guild in the database
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
// This function retrieves the configuration of a guild from the database
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
// This function loads translation files for different languages
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
// This function returns the appropriate translation for a given key, based on the guild's language
function t(guildId, key, placeholders = {}) {
  const lang = getGuildConfig(guildId)?.language || "en_us";
  let text = translations[lang]?.[key] || translations["en_us"]?.[key] || key;

  for (const [placeholder, value] of Object.entries(placeholders)) {
    text = text.replace(`{${placeholder}}`, value);
  }

  return text;
}

// Create a new Discord client instance
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates],
});

// Event listener for when the bot is ready
client.once("ready", () => {
  console.log(`Bot is running as ${client.user.tag}`);
  updateServerData(); // Perform the first update immediately
  setInterval(updateServerData, 5 * 60 * 1000); // Update every 5 minutes

  // Set bot activity to show it is listening to /setup
  client.user.setActivity("/setup", { type: ActivityType.Listening });
});

// Helper function to get the current time in Brasília (UTC-3)
// Returns the current time formatted for Brasília timezone
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

// Periodically update server data, including default admin roles and native AFK channel
// Updates the configuration for each guild that the bot is in
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

// Handle voice state updates to disconnect users from the AFK channel
// This function handles the logic to disconnect users from the AFK channel irrespective of mute status
client.on("voiceStateUpdate", async (oldState, newState) => {
  try {
    const guildConfig = getGuildConfig(newState.guild.id);
    if (!guildConfig || !guildConfig.afkChannelId) return;

    // Check if the user joined the configured AFK channel
    if (newState.channelId === guildConfig.afkChannelId) {
      if (newState.member.id === client.user.id) return; // Ignore the bot itself

      // Check bot permissions in the channel
      const botPermissions = newState.channel.permissionsFor(
        newState.guild.members.me
      );
      if (!botPermissions.has(PermissionsBitField.Flags.MoveMembers)) {
        console.error(t(newState.guild.id, "bot_move_permission_missing"));
        return;
      }

      // Disconnect the user from the AFK channel
      await newState.disconnect();
    }
  } catch (error) {
    console.error(t(newState.guild.id, "error_voice_state_update"), error);
  }
});

// New function to move users with both mic and audio muted for more than 5 minutes to AFK channel
const usersToAfkTimeout = new Map(); // Store timeout IDs for users
client.on("voiceStateUpdate", async (oldState, newState) => {
  try {
    const guildConfig = getGuildConfig(newState.guild.id);
    if (!guildConfig || !guildConfig.afkChannelId) return;

    // Move users to AFK channel if both audio and microphone are muted for more than 5 minutes
    if (
      newState.channelId &&
      newState.channelId !== guildConfig.afkChannelId &&
      newState.selfMute &&
      newState.selfDeaf
    ) {
      // If user wasn't muted previously or changed state, start/reset the timer
      if (!oldState.selfMute || !oldState.selfDeaf) {
        // Clear any existing timeout for this user
        if (usersToAfkTimeout.has(newState.id)) {
          clearTimeout(usersToAfkTimeout.get(newState.id));
        }

        // Set a new timeout to move the user to AFK channel after 5 minutes
        const timeoutId = setTimeout(async () => {
          const currentState = newState.guild.members.cache.get(
            newState.id
          )?.voice;
          if (
            currentState &&
            currentState.selfMute &&
            currentState.selfDeaf &&
            currentState.channelId !== guildConfig.afkChannelId
          ) {
            // Move user to AFK channel
            await currentState.setChannel(guildConfig.afkChannelId);
            console.log(
              t(newState.guild.id, "user_moved_to_afk", {
                user: currentState.member.user.tag,
              })
            );
          }
          usersToAfkTimeout.delete(newState.id); // Remove from the map after moving
        }, 5 * 60 * 1000);

        // Store the timeout ID so it can be cleared if needed
        usersToAfkTimeout.set(newState.id, timeoutId);
      }
    } else {
      // If the user is no longer muted or deafened, clear the timeout
      if (usersToAfkTimeout.has(newState.id)) {
        clearTimeout(usersToAfkTimeout.get(newState.id));
        usersToAfkTimeout.delete(newState.id);
      }
    }
  } catch (error) {
    console.error(t(newState.guild.id, "error_voice_state_update"), error);
  }
});

// Log in to Discord with the bot token
client.login(BOT_TOKEN);
