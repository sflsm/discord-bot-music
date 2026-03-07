require("dotenv").config();
const { REST, Routes, SlashCommandBuilder } = require("discord.js");

const commands = [
  new SlashCommandBuilder()
    .setName("play")
    .setDescription("Putar musik"),

  new SlashCommandBuilder()
    .setName("download")
    .setDescription("Download lagu dari YouTube")
    .addStringOption(o =>
      o.setName("url")
        .setDescription("Link YouTube")
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("playlist")
    .setDescription("Lihat dan hapus isi playlist"),

].map(c => c.toJSON());

const rest = new REST({ version: "10" }).setToken(process.env.TOKEN);

(async () => {
  console.log("🔁 Deploy slash command...");
  await rest.put(
    Routes.applicationGuildCommands(
      process.env.CLIENT_ID,
      process.env.GUILD_ID
    ),
    { body: commands }
  );
  console.log("✅ Slash command berhasil");
})();