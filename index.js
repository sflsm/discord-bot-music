require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

const {
  Client,
  GatewayIntentBits,
  Events,
  ChannelType,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder
} = require("discord.js");

const {
  joinVoiceChannel,
  createAudioPlayer,
  createAudioResource,
  AudioPlayerStatus,
  StreamType,
  generateDependencyReport
} = require("@discordjs/voice");

console.log(generateDependencyReport());

// ================= CLIENT =================
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates],
});

// ================= FOLDER =================
const MUSIC_DIR = path.join(__dirname, "music");
if (!fs.existsSync(MUSIC_DIR)) fs.mkdirSync(MUSIC_DIR);

// ================= VARIABLES =================
let playlist = [];
let originalPlaylist = [];
let index = 0;
let repeatMode = 0; // 0=off,1=queue,2=song
let shuffle = false;
let player;
let connection;
let currentTrack = null;
let textChannel;
let nowPlayingMessage = null;
let playedSongs = new Set();
const thumbnailMap = {}; // simpan thumbnail URL

// ================= EMBED =================
const baseEmbed = () => new EmbedBuilder().setColor(0x1db954).setTimestamp();

const controlButtons = () =>
  new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("shuffle").setLabel("🔀").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId("previous").setLabel("⏮").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId("play_pause").setLabel("⏯").setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId("next").setLabel("⏭").setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId("repeat").setLabel("🔁").setStyle(ButtonStyle.Secondary)
  );

function createNowPlayingEmbed(filename) {
  const thumbnail = thumbnailMap[filename];
  const repeatText = repeatMode === 0 ? "Off" : repeatMode === 1 ? "Queue" : "Song";
  const shuffleText = shuffle ? "On" : "Off";

  const embed = baseEmbed()
    .setTitle("𖦤 Now Playing")
    .setDescription(`♬ **${filename}**\n\n🔀 Shuffle: **${shuffleText}**  |  🔁 Repeat: **${repeatText}**`)
    .setFooter({ text: "Music Bot 24/7" });

  if (thumbnail && thumbnail.startsWith("http")) embed.setImage(thumbnail);
  return embed;
}

// ================= LOAD PLAYLIST =================
function loadPlaylist() {
  originalPlaylist = fs.readdirSync(MUSIC_DIR)
    .filter(f => f.endsWith(".mp3"))
    .map(f => path.join(MUSIC_DIR, f));
  playlist = [...originalPlaylist];
}

// ================= PLAY NEXT =================
function playNext() {
  if (!player || !connection || !playlist.length) return;

  let playIndex;

  // Repeat One
  if (repeatMode === 2 && currentTrack) {
    playIndex = playlist.indexOf(currentTrack);
  }

  // Shuffle mode
  else if (shuffle) {
    const availableSongs = playlist.map((_, i) => i).filter(i => !playedSongs.has(i));

    if (availableSongs.length === 0) {
      if (repeatMode === 1) {
        playedSongs.clear();
        availableSongs.push(...playlist.map((_, i) => i));
      } else {
        player.stop(true);
        textChannel?.send({
          embeds: [
            baseEmbed()
              .setTitle("📭 Bersambung...")
              .setDescription("Semua lagu sudah diputar.\nGunakan /play untuk memulai lagi.")
          ]
        });
        nowPlayingMessage = null;
        return;
      }
    }

    playIndex = availableSongs[Math.floor(Math.random() * availableSongs.length)];
    playedSongs.add(playIndex);
    index = playIndex + 1;
  }

  // Normal mode
  else {
    if (index >= playlist.length) {
      player.stop(true);
      textChannel?.send({
        embeds: [
          baseEmbed()
            .setTitle("📭 Bersambung...")
            .setDescription("Semua lagu sudah diputar.\nGunakan /play untuk memulai lagi.")
        ]
      });
      nowPlayingMessage = null;
      return;
    }
    playIndex = index;
    index++;
  }

  const file = playlist[playIndex];
  const ffmpeg = spawn("ffmpeg", [
    "-re",
    "-i", file,
    "-f", "s16le",
    "-ar", "48000",
    "-ac", "2",
    "pipe:1"
  ]);

  const resource = createAudioResource(ffmpeg.stdout, {
    inputType: StreamType.Raw,
    inlineVolume: true,
    highWaterMark: 1 << 26
  });

  player.play(resource);
  currentTrack = file;

  const filename = path.basename(file, ".mp3");
  const embed = createNowPlayingEmbed(filename);

  if (!nowPlayingMessage) {
    textChannel?.send({ embeds: [embed], components: [controlButtons()] })
      .then(msg => nowPlayingMessage = msg);
  } else {
    nowPlayingMessage.edit({ embeds: [embed], components: [controlButtons()] }).catch(() => {});
  }
}

// ================= READY =================
client.once(Events.ClientReady, async () => {
  console.log(`✅ Login sebagai ${client.user.tag}`);

  const guild = await client.guilds.fetch(process.env.GUILD_ID);
  const voiceChannel = await guild.channels.fetch(process.env.VOICE_CHANNEL_ID);
  textChannel = await guild.channels.fetch(process.env.TEXT_CHANNEL_ID);

  if (!voiceChannel || voiceChannel.type !== ChannelType.GuildVoice) {
    console.error("❌ Voice channel tidak valid");
    return;
  }
  if (!textChannel || textChannel.type !== ChannelType.GuildText) {
    console.error("❌ Text channel tidak valid");
    return;
  }

  connection = joinVoiceChannel({
    channelId: voiceChannel.id,
    guildId: guild.id,
    adapterCreator: guild.voiceAdapterCreator,
  });

  player = createAudioPlayer();
  connection.subscribe(player);

  player.on("error", e => { console.log("Audio error:", e.message); playNext(); });
  player.on(AudioPlayerStatus.Idle, playNext);

  loadPlaylist();
  shuffle = false;
  repeatMode = 0;
  playedSongs.clear();
  index = 0;
});

// ================= INTERACTION =================
function buildPlaylistUI() {
  if (!playlist.length) {
    return { embeds: [baseEmbed().setTitle("📂 Playlist").setDescription("Playlist kosong.")], components: [] };
  }

  const description = playlist.map((file, i) => `**${i + 1}.** ${path.basename(file, ".mp3")}`).join("\n");
  const embed = baseEmbed().setTitle("📂 Playlist").setDescription(description);

  const options = playlist.slice(0, 24).map((file, i) => ({
    label: path.basename(file, ".mp3").slice(0, 100),
    value: String(i)
  }));
  options.push({ label: "Hapus Semua Playlist", value: "delete_all" });

  const row = new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId("remove_select").setPlaceholder("Pilih lagu untuk dihapus").addOptions(options));
  return { embeds: [embed], components: [row] };
}

client.on(Events.InteractionCreate, async interaction => {

  // ===== SELECT MENU =====
  if (interaction.isStringSelectMenu() && interaction.customId === "remove_select") {
    await interaction.deferReply({ ephemeral: true });
    const selected = interaction.values[0];

    if (selected === "delete_all") {
      const total = playlist.length;
      if (player) player.stop(true);
      playlist = [];
      index = 0;
      await new Promise(r => setTimeout(r, 1000));
      fs.readdirSync(MUSIC_DIR).forEach(f => { if (f.endsWith(".mp3")) fs.unlinkSync(path.join(MUSIC_DIR, f)); });
      return interaction.editReply({ embeds: [baseEmbed().setTitle("🗑️ Playlist Dihapus").setDescription(`Berhasil menghapus **${total} lagu** dari playlist.`)] });
    }

    const removed = playlist.splice(parseInt(selected), 1)[0];
    if (fs.existsSync(removed)) fs.unlinkSync(removed);
    if (index >= playlist.length) index = 0;
    return interaction.editReply(buildPlaylistUI());
  }

  // ===== BUTTONS =====
  if (interaction.isButton()) {
    await interaction.deferUpdate();

    switch (interaction.customId) {
      case "shuffle":
        shuffle = !shuffle;
        playedSongs.clear();
        if (!shuffle) {
          playlist = [...originalPlaylist];
          const pos = playlist.indexOf(currentTrack);
          index = pos === -1 ? 0 : pos + 1;
        }
        break;

      case "previous":
        if (!playlist.length) return;
        if (shuffle) {
          const currentIdx = playlist.indexOf(currentTrack);
          if (currentIdx !== -1) playedSongs.delete(currentIdx);
        } else {
          index = Math.max(index - 2, 0);
        }
        player.stop();
        break;

      case "play_pause":
        if (player.state.status === AudioPlayerStatus.Playing) player.pause();
        else player.unpause();
        break;

      case "next":
        if (!playlist.length) return;
        player.stop();
        break;

      case "repeat":
        repeatMode = (repeatMode + 1) % 3;
        break;
    }

    updateNowPlayingUI();
    return;
  }

  // ===== COMMANDS =====
  if (!interaction.isChatInputCommand()) return;

  // Playlist
  if (interaction.commandName === "playlist") return interaction.reply(buildPlaylistUI());

  // Play
  if (interaction.commandName === "play") {
    if (!playlist.length) return interaction.reply("⚠︎ Playlist kosong.");
    playedSongs.clear();
    index = 0;
    playNext();
    return interaction.reply("𝄞 Memulai playlist...");
  }

  // Stop
  if (interaction.commandName === "stop") {
    player.stop(true);
    return interaction.reply("⏹ Musik dihentikan.");
  }

  // Skip
  if (interaction.commandName === "skip") {
    player.stop();
    return interaction.reply("⏭ Lagu dilewati.");
  }

  if (interaction.commandName === "download") {
  const url = interaction.options.getString("url");
  const COOKIES_FILE = path.join(__dirname, "cookies.txt");
  if (!fs.existsSync(COOKIES_FILE)) {
    return interaction.reply({
      embeds: [
        baseEmbed()
          .setTitle("❌ Cookies Tidak Ditemukan")
          .setDescription("Silakan letakkan file `cookies.txt` di folder project.")
      ],
      ephemeral: true
    });
  }

  // DEFER REPLY
  await interaction.deferReply({ flags: 64 });
  await interaction.editReply({
    embeds: [baseEmbed().setTitle("📥 Download").setDescription("Sedang memproses, harap tunggu...")]
  });

  try {
    // Path ke yt-dlp
    const ytDlpPath = path.join(__dirname, "yt-dlp.exe"); // Windows, sesuaikan di VPS misal "yt-dlp"

    // ================= AMBIL METADATA =================
    let json = "";
    await new Promise((resolve, reject) => {
      const info = spawn(ytDlpPath, [
        "--dump-json",
        "--no-playlist",
        "--cookies", COOKIES_FILE,
        "--user-agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        url
      ]);

      info.stdout.on("data", d => json += d.toString());
      info.stderr.on("data", d => console.log(d.toString()));

      info.on("error", reject);
      info.on("close", code => code === 0 ? resolve() : reject(new Error("Gagal ambil metadata")));
    });

    let meta;
    try { meta = JSON.parse(json); } 
    catch { return interaction.editReply("❌ Gagal membaca metadata video."); }

    const safeTitle = meta.title.replace(/[\\/:*?"<>|]/g, "");

    // ================= DOWNLOAD AUDIO =================
    await new Promise((resolve, reject) => {
      const dl = spawn(ytDlpPath, [
        "-x",
        "--audio-format", "mp3",
        "--audio-quality", "0",
        "--concurrent-fragments", "10",
        "--buffer-size", "16K",
        "--no-playlist",
        "--cookies", COOKIES_FILE,
        "--user-agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "--sleep-interval", "1-3", // delay antar request untuk menghindari bot detection
        "-o", `${MUSIC_DIR}/${safeTitle}.%(ext)s`,
        url
      ]);

      dl.stdout.on("data", data => console.log(data.toString()));
      dl.stderr.on("data", data => console.log(data.toString()));

      dl.on("error", reject);
      dl.on("close", code => code === 0 ? resolve() : reject(new Error("Gagal download")));
    });

    // ================= SIMPAN THUMBNAIL =================
    thumbnailMap[safeTitle] = meta.thumbnail;
    loadPlaylist();

    await interaction.editReply({
      embeds: [
        baseEmbed()
          .setTitle("✅ Download Selesai")
          .setDescription(`🎵 **${meta.title}**`)
          .setThumbnail(meta.thumbnail)
      ]
    });

  } catch (err) {
    console.error(err);
    await interaction.editReply({
      embeds: [
        baseEmbed()
          .setTitle("❌ Download Gagal")
          .setDescription(err.message)
      ]
    });
  }
}
});

// ================= UPDATE NOW PLAYING =================
async function updateNowPlayingUI() {
  if (!nowPlayingMessage) return;

  const currentFile = playlist.length > 0 ? playlist[(index - 1 + playlist.length) % playlist.length] : null;
  const filename = currentFile ? path.basename(currentFile, ".mp3") : "Tidak ada lagu";

  const embed = createNowPlayingEmbed(filename);
  nowPlayingMessage.edit({ embeds: [embed], components: [controlButtons()] }).catch(() => {});
}

// ================= ERROR HANDLER =================
client.on("error", console.error);
process.on("unhandledRejection", console.error);

client.login(process.env.TOKEN);