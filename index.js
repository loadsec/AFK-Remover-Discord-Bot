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
    language TEXT DEFAULT 'en_us'
  )
`);

// Helper function to save guild config to SQLite
function saveGuildConfig(guildId, config) {
  const stmt = db.prepare(`
    INSERT INTO guilds (guild_id, server_name, afk_channel_id, afk_channel_name, language)
    VALUES (@guildId, @serverName, @afkChannelId, @afkChannelName, @language)
    ON CONFLICT(guild_id) DO UPDATE SET
      server_name = COALESCE(guilds.server_name, @serverName),
      afk_channel_id = COALESCE(guilds.afk_channel_id, @afkChannelId),
      afk_channel_name = COALESCE(guilds.afk_channel_name, @afkChannelName),
      language = COALESCE(guilds.language, @language)
  `);
  stmt.run({
    guildId,
    serverName: config.serverName,
    afkChannelId: config.afkChannelId,
    afkChannelName: config.afkChannelName,
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
  console.log(t(null, "bot_running", { botTag: client.user.tag }));
  updateServerData(); // Perform the first update immediately
  setInterval(updateServerData, 5 * 60 * 1000); // Update every 5 minutes

  // Set bot activity to show it is listening to /afkinfo
  client.user.setActivity(
    t(null, "activity_listening_command", { command: "/afkinfo" }),
    { type: ActivityType.Listening }
  );

  // Register slash commands
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

// Register slash commands function
async function registerSlashCommands() {
  const rest = new REST({ version: "10" }).setToken(BOT_TOKEN);

  try {
    console.log(t(null, "registering_commands"));

    const commands = [
      {
        name: "afkinfo",
        description: t(null, "afkinfo_description"),
      },
    ];

    await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands });

    console.log(t(null, "commands_registered_successfully"));
  } catch (error) {
    console.error(t(null, "error_registering_commands"), error);
  }
}

// Periodically update server data, including default admin roles and native AFK channel
async function updateServerData() {
  client.guilds.cache.forEach(async (guild) => {
    try {
      const guildConfig = getGuildConfig(guild.id) || {};
      guildConfig.serverName = guildConfig.serverName || guild.name;

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
      console.error(
        t(null, "error_updating_server_data", { guildId: guild.id }),
        error
      );
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

// Command interaction handler
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

    const embed = new EmbedBuilder()
      .setColor(0x0099ff)
      .setTitle(t(guildId, "afkinfo_title"))
      .addFields(
        {
          name: t(guildId, "afkinfo_channel"),
          value: guildConfig.afkChannelName || t(guildId, "afkinfo_not_set"),
          inline: true,
        },
        {
          name: t(guildId, "afkinfo_language"),
          value: guildConfig.language?.toUpperCase() || "EN_US",
          inline: true,
        }
      )
      .setFooter({ text: t(guildId, "afkinfo_footer") })
      .setTimestamp();

    return interaction.reply({ embeds: [embed], ephemeral: true });
  }
});

client.login(BOT_TOKEN);
