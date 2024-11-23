const fs = require("fs");
const path = require("path");
const {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  EmbedBuilder,
  ActivityType,
} = require("discord.js");
const Database = require("better-sqlite3");
require("dotenv").config();

// Environment variables
const BOT_TOKEN = process.env.BOT_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID; // Assuming GUILD_ID is set in the .env file

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
      server_name = COALESCE(guilds.server_name, @serverName),
      afk_channel_id = COALESCE(guilds.afk_channel_id, @afkChannelId),
      afk_channel_name = COALESCE(guilds.afk_channel_name, @afkChannelName),
      allowed_roles = COALESCE(guilds.allowed_roles, @allowedRoles),
      language = COALESCE(guilds.language, @language)
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

  // Set bot activity to show it is listening to /afkinfo
  client.user.setActivity("/afkinfo", { type: ActivityType.Listening });

  // Delete and re-register slash commands
  registerSlashCommands();
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

// Register slash commands function (delete old commands and register new ones)
async function registerSlashCommands() {
  const rest = new REST({ version: "10" }).setToken(BOT_TOKEN);

  try {
    console.log("Deleting all existing slash commands...");

    // Delete all global commands
    await rest.put(Routes.applicationCommands(CLIENT_ID), { body: [] });
    console.log("Successfully deleted all global application commands.");

    // Delete all guild-specific commands
    await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), {
      body: [],
    });
    console.log("Successfully deleted all guild commands.");

    console.log("Registering new slash commands...");

    const commands = [
      {
        name: "afkinfo",
        description: t(null, "afkinfo_description"),
      },
    ];

    await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands });

    console.log("Slash commands registered successfully!");
  } catch (error) {
    console.error("Error registering commands:", error);
  }
}

// Periodically update server data, including default admin roles and native AFK channel
async function updateServerData() {
  client.guilds.cache.forEach(async (guild) => {
    try {
      const guildConfig = getGuildConfig(guild.id) || {};
      guildConfig.serverName = guildConfig.serverName || guild.name;

      // Detect admin roles if not already set
      if (!guildConfig.allowedRoles) {
        const adminRoles = findAdminRoles(guild);
        guildConfig.allowedRoles = adminRoles;
      }

      // Detect preferred locale for language if not already set
      if (!guildConfig.language) {
        const locale = guild.preferredLocale.toLowerCase().replace("-", "_"); // Convert pt-BR to pt_br
        guildConfig.language = translations[locale] ? locale : "en_us"; // Default to en_us
      }

      // Check native AFK channel if not already set
      if (!guildConfig.afkChannelId) {
        const afkChannelId = guild.afkChannelId;
        if (afkChannelId) {
          const afkChannel = guild.channels.cache.get(afkChannelId);
          if (afkChannel) {
            guildConfig.afkChannelId = afkChannel.id;
            guildConfig.afkChannelName = afkChannel.name;
          }
        }
      }

      // Save updated config only if it was not previously set
      saveGuildConfig(guild.id, guildConfig);
    } catch (error) {
      console.error(`Error updating server data for guild ${guild.id}:`, error);
    }
  });

  console.log(t(null, "server_data_updated", { time: getBrasiliaTime() }));
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

// Track voice states to manage AFK channel behavior
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
        return;
      }

      // Disconnect the user
      await newState.disconnect();
    }

    // Check if a user is in a voice channel and muted for more than 5 minutes
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
          // Move user to AFK channel if still muted and deafened after 5 minutes
          await currentState.setChannel(afkChannelId);
        }
      }, 5 * 60 * 1000); // 5 minutes
    }
  } catch (error) {
    console.error(t(newState.guild.id, "error_voice_state_update"), error);
  }
});

client.login(BOT_TOKEN);
