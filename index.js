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
            description:
              "Enter the language for this server (e.g., en_us, pt_br).",
            type: 3, // STRING
            required: true,
          },
        ],
      },
      {
        name: "afkinfo",
        description:
          "Displays the current AFK channel, roles, and language configuration.",
      },
      {
        name: "setafk",
        description: "Set the AFK channel for the bot.",
        options: [
          {
            name: "channel",
            description: "The voice channel to set as AFK (name or ID).",
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
            description:
              "Mention the roles allowed to configure the bot (comma-separated IDs or names).",
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
            description:
              "Enter the language for this server (e.g., en_us, pt_br).",
            type: 3, // STRING
            required: false,
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

  console.log(`Server data updated at ${getBrasiliaTime()}`);
}

// Handle interaction commands
client.on("interactionCreate", async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  const { commandName, options, guild, member } = interaction;

  // Verifica se o membro tem permissão para executar o comando
  const hasPermission = () => {
    const guildConfig = getGuildConfig(guild.id);
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

    // Validate language
    if (!translations[selectedLanguage]) {
      return interaction.reply({
        content: t(guild.id, "invalid_language"),
        ephemeral: true,
      });
    }

    // Save configuration
    const config = {
      serverName: guild.name,
      afkChannelId: afkChannel.id,
      afkChannelName: afkChannel.name,
      allowedRoles: [...roles, ...extraRoles].map((role) => ({
        id: role.id,
        name: role.name,
      })),
      language: selectedLanguage,
    };

    saveGuildConfig(guild.id, config);

    return interaction.reply({
      content: t(guild.id, "setup_success", {
        channel: afkChannel.name,
        language: selectedLanguage.toUpperCase(),
      }),
      ephemeral: true,
    });
  }

  if (commandName === "setafk") {
    const channelInput = options.getString("channel");

    // Find AFK channel
    const afkChannel = findVoiceChannel(guild, channelInput);
    if (!afkChannel) {
      return interaction.reply({
        content: t(guild.id, "invalid_channel"),
        ephemeral: true,
      });
    }

    // Update AFK channel in configuration
    const guildConfig = getGuildConfig(guild.id) || {};
    guildConfig.afkChannelId = afkChannel.id;
    guildConfig.afkChannelName = afkChannel.name;
    saveGuildConfig(guild.id, guildConfig);

    return interaction.reply({
      content: t(guild.id, "afk_channel_set", { channel: afkChannel.name }),
      ephemeral: true,
    });
  }

  if (commandName === "setroles") {
    const rolesInput = options.getString("roles");

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

    // Update roles in configuration
    const guildConfig = getGuildConfig(guild.id) || {};
    guildConfig.allowedRoles = [...roles, ...extraRoles].map((role) => ({
      id: role.id,
      name: role.name,
    }));
    saveGuildConfig(guild.id, guildConfig);

    return interaction.reply({
      content: t(guild.id, "roles_set"),
      ephemeral: true,
    });
  }

  if (commandName === "setlang") {
    const selectedLanguage = options.getString("language");

    // If no language is provided, show available languages
    if (!selectedLanguage) {
      const availableLanguages = Object.keys(translations)
        .map((lang) => lang.toUpperCase())
        .join(", ");
      const embed = new EmbedBuilder()
        .setColor(0x0099ff)
        .setTitle(t(guild.id, "available_languages_title"))
        .setDescription(availableLanguages)
        .setFooter({ text: t(guild.id, "available_languages_footer") })
        .setTimestamp();

      return interaction.reply({ embeds: [embed], ephemeral: true });
    }

    // Validate language
    if (!translations[selectedLanguage]) {
      return interaction.reply({
        content: t(guild.id, "invalid_language"),
        ephemeral: true,
      });
    }

    // Update language in configuration
    const guildConfig = getGuildConfig(guild.id) || {};
    guildConfig.language = selectedLanguage;
    saveGuildConfig(guild.id, guildConfig);

    return interaction.reply({
      content: t(guild.id, "language_set", {
        language: selectedLanguage.toUpperCase(),
      }),
      ephemeral: true,
    });
  }

  if (commandName === "afkinfo") {
    const guildConfig = getGuildConfig(guild.id);
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
