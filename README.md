# 🌟 AFK Remover Bot 🌟

A professional Discord bot designed to manage your server's AFK users effectively. Disconnects users from the configured AFK channel automatically, keeping your server active and organised.

---

## ✨ Features

- 🔄 **Auto-disconnects** users from AFK channels.
- 🌐 **Multi-server support** with independent configurations.
- 🌎 **Multi-language support**: Includes English, Spanish, French, and more.
- 🛠️ **Configurable roles and channels** using simple commands.
- 📊 **Periodic updates** to ensure accurate server data.

---

## 🛠️ Prerequisites

Before you start, ensure you have the following installed:

- 📦 [Node.js](https://nodejs.org/) (version 16 or later).
- 🧶 [Yarn](https://yarnpkg.com/) (recommended for this project).
- 🔑 A valid Discord bot token (get yours from the [Discord Developer Portal](https://discord.com/developers/applications)).

---

## 🚀 Installation

### 1️⃣ Clone the Repository

```bash
git clone https://github.com/loadsec/AFK-Remover-Discord-Bot.git
cd afk-remover-bot
```

### 2️⃣ Install Dependencies

#### Using Yarn (🌟 Recommended)

```bash
yarn install
```

#### Using NPM

```bash
npm install
```

### 3️⃣ Configure Environment Variables

Create a `.env` file in the root directory and add the following:

```plaintext
BOT_TOKEN=your-bot-token
CLIENT_ID=your-bot-client-id
```

Replace `your-bot-token` and `your-bot-client-id` with your bot's token and client ID from the [Discord Developer Portal](https://discord.com/developers/applications).

---

## 🎯 Running the Bot

### With Yarn 🌟

```bash
yarn start
```

### With NPM

```bash
npm start
```

---

## 💻 Commands

### `/setup`

- 📋 **Description**: Configure the bot for your server.
- 🔧 **Options**:
  - `channel`: Set the AFK voice channel (name or ID).
  - `roles`: Specify roles allowed to modify configurations (comma-separated).
  - `language`: Choose the server's language.

### `/afkinfo`

- 📜 **Description**: Display the current AFK settings for the server, including the channel, roles, and language.

---

## 🌍 Translations

The bot supports multiple languages! You can find translation files in the `translations` directory. To add a new language:

1. 📁 Create a new `.json` file in the `translations` folder (e.g., `es.json` for Spanish).
2. 📝 Follow the structure of existing translation files.

---

## 🤝 Contributing

We ❤️ contributions!

1. Fork the repository.
2. Make your changes.
3. Submit a pull request with a detailed description.

---

## 💬 Need Help?

If you encounter any issues, feel free to open an issue or reach out to the contributors.

🌟 Thank you for using **AFK Remover Bot**! 🌟
