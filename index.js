require('dotenv').config();
const {
  Client,
  GatewayIntentBits,
  Partials,
  EmbedBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  PermissionFlagsBits,
  Events,
  AttachmentBuilder
} = require('discord.js');

const fs = require('fs');
const path = require('path');

// ============================
// RAILWAY / VOLUME UYUMLU CONFIG YOLU
// ============================
const DATA_DIR = process.env.RAILWAY_VOLUME_MOUNT_PATH
  ? process.env.RAILWAY_VOLUME_MOUNT_PATH
  : __dirname;

const CONFIG_PATH = path.join(DATA_DIR, 'config.json');

const defaultConfig = {
  logChannel: null,
  transcriptChannel: null,
  staffRoles: [],
  modRoles: [],
  ticketCategory: null,
  blacklist: [],
  activeTickets: {},   // { channelId: { owner, type, createdAt, claimedBy } }
  stats: {
    totalTickets: 0,
    closedTickets: 0,
    claims: {},
    ratings: {}
  }
};

let config = JSON.parse(JSON.stringify(defaultConfig));

function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      const raw = fs.readFileSync(CONFIG_PATH, 'utf8');
      const parsed = JSON.parse(raw);
      config = {
        ...defaultConfig,
        ...parsed,
        stats: { ...defaultConfig.stats, ...(parsed.stats || {}) }
      };
    } else {
      saveConfig();
    }
  } catch (e) {
    console.error('❌ Config yükleme hatası:', e);
  }
}

function saveConfig() {
  try {
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf8');
  } catch (e) {
    console.error('❌ Config kaydetme hatası:', e);
  }
}

loadConfig();

// Aktif ticketlar (config'ten yükle)
const activeTickets = new Map(Object.entries(config.activeTickets || {}));

function saveActiveTickets() {
  config.activeTickets = Object.fromEntries(activeTickets);
  saveConfig();
}

// ============================
// CLIENT
// ============================
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers
  ],
  partials: [Partials.Channel, Partials.Message]
});

// ============================
// TICKET KATEGORİLERİ
// ============================
const TICKET_TYPES = {
  partner: { label: 'Partner',  emoji: '🤝', description: 'Partnerlik başvurusu',     color: 0x5865F2 },
  merge:   { label: 'Merge',    emoji: '🔗', description: 'Merge (birleşme) talebi',  color: 0x57F287 },
  siege:   { label: 'Siege',    emoji: '⚔️', description: 'Siege (kuşatma) başvurusu', color: 0xED4245 },
  sikayet: { label: 'Şikayet',  emoji: '⚠️', description: 'Kullanıcı şikayeti',       color: 0xFEE75C },
  destek:  { label: 'Destek',   emoji: '🛠️', description: 'Genel destek',             color: 0xEB459E },
  cekilis: { label: 'Çekiliş',  emoji: '🎉', description: 'Çekiliş düzenleme',        color: 0x9B59B6 }
};

// ============================
// YARDIMCILAR
// ============================
function isStaff(member) {
  if (!member) return false;
  if (member.permissions.has(PermissionFlagsBits.Administrator)) return true;
  return config.staffRoles.some(rid => member.roles.cache.has(rid));
}

function isMod(member) {
  if (!member) return false;
  if (member.permissions.has(PermissionFlagsBits.Administrator)) return true;
  return config.modRoles.some(rid => member.roles.cache.has(rid));
}

async function sendLog(guild, embed) {
  if (!config.logChannel) return;
  const ch = guild.channels.cache.get(config.logChannel);
  if (ch) ch.send({ embeds: [embed] }).catch(() => {});
}

// ============================
// TRANSCRIPT
// ============================
async function createTranscript(channel) {
  let messages;
  try {
    messages = await channel.messages.fetch({ limit: 500 });
  } catch {
    return null;
  }

  const sorted = [...messages.values()].sort((a, b) => a.createdTimestamp - b.createdTimestamp);

  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  let html = `<!DOCTYPE html>
<html lang="tr"><head><meta charset="UTF-8">
<title>Transcript - ${esc(channel.name)}</title>
<style>
  body { font-family: Arial, sans-serif; background: #2b2d31; color: #dbdee1; padding: 20px; }
  .header { background: #5865F2; padding: 15px; border-radius: 8px; margin-bottom: 20px; }
  .msg { background: #313338; padding: 10px; margin: 8px 0; border-radius: 6px; }
  .author { color: #5865F2; font-weight: bold; }
  .time { color: #949ba4; font-size: 12px; margin-left: 8px; }
  .content { margin-top: 5px; white-space: pre-wrap; }
  img { max-width: 300px; border-radius: 5px; margin-top: 5px; }
  a { color: #00aff4; }
</style></head><body>
<div class="header">
  <h1>📄 Ticket Transcript</h1>
  <p><b>Kanal:</b> #${esc(channel.name)}</p>
  <p><b>Sunucu:</b> ${esc(channel.guild.name)}</p>
  <p><b>Tarih:</b> ${new Date().toLocaleString('tr-TR')}</p>
  <p><b>Mesaj Sayısı:</b> ${sorted.length}</p>
</div>`;

  for (const msg of sorted) {
    const time = new Date(msg.createdTimestamp).toLocaleString('tr-TR');
    html += `<div class="msg">
      <span class="author">${esc(msg.author.tag)}</span>
      <span class="time">${esc(time)}</span>
      <div class="content">${esc(msg.content) || '<i>[ek/embed]</i>'}</div>`;

    for (const att of msg.attachments.values()) {
      if (att.contentType && att.contentType.startsWith('image/')) {
        html += `<img src="${esc(att.url)}" alt="ek">`;
      } else {
        html += `<div><a href="${esc(att.url)}">📎 ${esc(att.name)}</a></div>`;
      }
    }
    html += `</div>`;
  }
  html += `</body></html>`;

  const fileName = `transcript-${channel.name}-${Date.now()}.html`;
  const filePath = path.join(DATA_DIR, fileName);

  try {
    fs.writeFileSync(filePath, html, 'utf8');
    return { filePath, fileName };
  } catch (e) {
    console.error('Transcript yazma hatası:', e);
    return null;
  }
}

// ============================
// HAZIR
// ============================
client.once(Events.ClientReady, () => {
  console.log(`✅ ${client.user.tag} olarak giriş yapıldı!`);
  console.log(`📊 ${client.guilds.cache.size} sunucu, ${client.users.cache.size} kullanıcı`);
  client.user.setActivity('!yardım | Pangea', { type: 3 });
});

// ============================
// MESAJ KOMUTLARI
// ============================
client.on(Events.MessageCreate, async (message) => {
  try {
    if (message.author.bot || !message.guild) return;
    if (!message.content.startsWith('!')) return;

    const args = message.content.slice(1).trim().split(/ +/);
    const command = args.shift().toLowerCase();

    // ---------- !yardım ----------
    if (command === 'yardım' || command === 'help') {
      const embed = new EmbedBuilder()
        .setTitle('🌍 Pangea Bot - Komutlar')
        .setDescription('Aşağıda mevcut komutları bulabilirsin.')
        .setColor(0x5865F2)
        .addFields(
          { name: '📌 Genel', value: '`!yardım` `!ping` `!bilgi` `!avatar` `!sunucu-bilgi` `!kullanıcı-bilgi` `!zar` `!yazı-tura` `!8top`' },
          { name: '🎫 Ticket', value: '`!ticket-panel` `!kapat` `!blacklist-ekle` `!blacklist-çıkar`' },
          { name: '🎉 Çekiliş', value: '`!çekiliş-başlat <süre dk> <kazanan> <ödül>`' },
          { name: '⚙️ Ayarlar (Admin)', value: '`!ayarla-log` `!ayarla-transcript` `!ayarla-yetkili` `!ayarla-mod` `!ayarla-kategori`' },
          { name: '🔨 Moderasyon (Yetkili)', value: '`!ban` `!kick` `!mute` `!unmute` `!warn` `!temizle` `!slowmode` `!kilit` `!kilit-aç`' },
          { name: '📊 İstatistik', value: '`!istatistik`' }
        )
        .setFooter({ text: 'Pangea Bot', iconURL: client.user.displayAvatarURL() })
        .setTimestamp();
      return message.reply({ embeds: [embed] });
    }

    // ---------- !ping ----------
    if (command === 'ping') {
      const msg = await message.reply('🏓 Hesaplanıyor...');
      const latency = msg.createdTimestamp - message.createdTimestamp;
      return msg.edit(`🏓 **Pong!**\n📡 Gecikme: \`${latency}ms\`\n💓 WebSocket: \`${client.ws.ping}ms\``);
    }

    // ---------- !bilgi ----------
    if (command === 'bilgi') {
      const embed = new EmbedBuilder()
        .setTitle('🌍 Pangea Bot')
        .setDescription('Pangea, destek ve genel komutlar için tasarlanmış modern bir Discord botudur.')
        .setColor(0x5865F2)
        .addFields(
          { name: '📊 Sunucu', value: `${client.guilds.cache.size}`, inline: true },
          { name: '👥 Kullanıcı', value: `${client.users.cache.size}`, inline: true },
          { name: '📚 Kütüphane', value: 'discord.js v14', inline: true }
        )
        .setFooter({ text: 'Pangea • 2025' })
        .setTimestamp();
      return message.reply({ embeds: [embed] });
    }

    // ---------- EĞLENCE ----------
    if (command === 'avatar') {
      const user = message.mentions.users.first() || message.author;
      const embed = new EmbedBuilder()
        .setTitle(`${user.username} - Avatar`)
        .setImage(user.displayAvatarURL({ size: 1024, dynamic: true }))
        .setColor(0x5865F2);
      return message.reply({ embeds: [embed] });
    }

    if (command === 'sunucu-bilgi') {
      const g = message.guild;
      const embed = new EmbedBuilder()
        .setTitle(`🏰 ${g.name}`)
        .setThumbnail(g.iconURL({ dynamic: true }))
        .setColor(0x5865F2)
        .addFields(
          { name: '👑 Sahip', value: `<@${g.ownerId}>`, inline: true },
          { name: '👥 Üye', value: `${g.memberCount}`, inline: true },
          { name: '📅 Kuruluş', value: `<t:${Math.floor(g.createdTimestamp / 1000)}:D>`, inline: true },
          { name: '💬 Kanal', value: `${g.channels.cache.size}`, inline: true },
          { name: '🎭 Rol', value: `${g.roles.cache.size}`, inline: true }
        );
      return message.reply({ embeds: [embed] });
    }

    if (command === 'kullanıcı-bilgi') {
      const user = message.mentions.users.first() || message.author;
      const member = await message.guild.members.fetch(user.id).catch(() => null);
      if (!member) return message.reply('❌ Kullanıcı bulunamadı.');
      const embed = new EmbedBuilder()
        .setTitle(`👤 ${user.tag}`)
        .setThumbnail(user.displayAvatarURL({ dynamic: true }))
        .setColor(0x5865F2)
        .addFields(
          { name: '🆔 ID', value: user.id, inline: true },
          { name: '📅 Hesap', value: `<t:${Math.floor(user.createdTimestamp / 1000)}:D>`, inline: true },
          { name: '📥 Katılım', value: `<t:${Math.floor(member.joinedTimestamp / 1000)}:D>`, inline: true }
        );
      return message.reply({ embeds: [embed] });
    }

    if (command === 'zar') return message.reply(`🎲 Zar: **${Math.floor(Math.random() * 6) + 1}**`);
    if (command === 'yazı-tura') return message.reply(`🪙 **${Math.random() < 0.5 ? 'Yazı' : 'Tura'}**`);
    if (command === '8top') {
      const cevaplar = ['Evet ✅', 'Hayır ❌', 'Belki 🤔', 'Kesinlikle ✅', 'Asla ❌', 'Bilmiyorum 😶', 'Muhtemelen ✅', 'Şüpheliyim 🤨'];
      return message.reply(`🎱 ${cevaplar[Math.floor(Math.random() * cevaplar.length)]}`);
    }

    // ---------- !istatistik ----------
    if (command === 'istatistik') {
      const s = config.stats;
      let topClaim = 'Yok', topClaimCount = 0;
      for (const [uid, count] of Object.entries(s.claims)) {
        if (count > topClaimCount) { topClaimCount = count; topClaim = `<@${uid}> (${count})`; }
      }
      let topRated = 'Yok', topAvg = 0;
      for (const [uid, data] of Object.entries(s.ratings)) {
        const avg = data.count ? data.total / data.count : 0;
        if (avg > topAvg) { topAvg = avg; topRated = `<@${uid}> (⭐ ${avg.toFixed(2)})`; }
      }
      const embed = new EmbedBuilder()
        .setTitle('📊 Pangea İstatistikleri')
        .setColor(0x5865F2)
        .addFields(
          { name: '🎫 Toplam Açılan', value: `${s.totalTickets}`, inline: true },
          { name: '🔒 Kapatılan', value: `${s.closedTickets}`, inline: true },
          { name: '💬 Aktif', value: `${activeTickets.size}`, inline: true },
          { name: '✋ En Çok Üstlenen', value: topClaim, inline: true },
          { name: '⭐ En Yüksek Puan', value: topRated, inline: true }
        )
        .setTimestamp();
      return message.reply({ embeds: [embed] });
    }

    // ============================
    // AYAR KOMUTLARI
    // ============================
    if (command === 'ayarla-log') {
      if (!message.member.permissions.has(PermissionFlagsBits.Administrator))
        return message.reply('❌ Yönetici yetkisi gerekli.');
      const ch = message.mentions.channels.first();
      if (!ch) return message.reply('❌ Kanal etiketle.');
      config.logChannel = ch.id; saveConfig();
      return message.reply(`✅ Log kanalı: ${ch}`);
    }

    if (command === 'ayarla-transcript') {
      if (!message.member.permissions.has(PermissionFlagsBits.Administrator))
        return message.reply('❌ Yönetici yetkisi gerekli.');
      const ch = message.mentions.channels.first();
      if (!ch) return message.reply('❌ Kanal etiketle.');
      config.transcriptChannel = ch.id; saveConfig();
      return message.reply(`✅ Transcript kanalı: ${ch}`);
    }

    if (command === 'ayarla-yetkili') {
      if (!message.member.permissions.has(PermissionFlagsBits.Administrator))
        return message.reply('❌ Yönetici yetkisi gerekli.');
      const role = message.mentions.roles.first();
      if (!role) return message.reply('❌ Rol etiketle.');
      if (!config.staffRoles.includes(role.id)) config.staffRoles.push(role.id);
      saveConfig();
      return message.reply(`✅ Yetkili rolü eklendi: ${role}`);
    }

    if (command === 'ayarla-mod') {
      if (!message.member.permissions.has(PermissionFlagsBits.Administrator))
        return message.reply('❌ Yönetici yetkisi gerekli.');
      const role = message.mentions.roles.first();
      if (!role) return message.reply('❌ Rol etiketle.');
      if (!config.modRoles.includes(role.id)) config.modRoles.push(role.id);
      saveConfig();
      return message.reply(`✅ Mod rolü eklendi: ${role}`);
    }

    if (command === 'ayarla-kategori') {
      if (!message.member.permissions.has(PermissionFlagsBits.Administrator))
        return message.reply('❌ Yönetici yetkisi gerekli.');
      const cat = message.mentions.channels.first();
      if (!cat || cat.type !== ChannelType.GuildCategory)
        return message.reply('❌ Bir kategori etiketle.');
      config.ticketCategory = cat.id; saveConfig();
      return message.reply(`✅ Ticket kategorisi: **${cat.name}**`);
    }

    // ---------- BLACKLIST ----------
    if (command === 'blacklist-ekle') {
      if (!message.member.permissions.has(PermissionFlagsBits.Administrator))
        return message.reply('❌ Yetki yok.');
      const user = message.mentions.users.first();
      if (!user) return message.reply('❌ Kullanıcı etiketle.');
      if (!config.blacklist.includes(user.id)) config.blacklist.push(user.id);
      saveConfig();
      return message.reply(`🚫 ${user.tag} kara listeye eklendi.`);
    }

    if (command === 'blacklist-çıkar') {
      if (!message.member.permissions.has(PermissionFlagsBits.Administrator))
        return message.reply('❌ Yetki yok.');
      const user = message.mentions.users.first();
      if (!user) return message.reply('❌ Kullanıcı etiketle.');
      config.blacklist = config.blacklist.filter(id => id !== user.id);
      saveConfig();
      return message.reply(`✅ ${user.tag} kara listeden çıkarıldı.`);
    }

    // ============================
    // MODERASYON
    // ============================
    if (command === 'ban') {
      if (!isMod(message.member)) return message.reply('❌ Yetkin yok.');
      const user = message.mentions.users.first();
      const reason = args.slice(1).join(' ') || 'Sebep yok';
      if (!user) return message.reply('❌ Kullanıcı etiketle.');
      const member = await message.guild.members.fetch(user.id).catch(() => null);
      if (!member || !member.bannable) return message.reply('❌ Banlayamıyorum.');
      await member.ban({ reason });
      sendLog(message.guild, new EmbedBuilder().setTitle('🔨 Ban').setColor(0xED4245)
        .addFields(
          { name: 'Kullanıcı', value: `${user.tag}`, inline: true },
          { name: 'Yetkili', value: `${message.author.tag}`, inline: true },
          { name: 'Sebep', value: reason }
        ).setTimestamp());
      return message.reply(`🔨 **${user.tag}** banlandı.`);
    }

    if (command === 'kick') {
      if (!isMod(message.member)) return message.reply('❌ Yetkin yok.');
      const user = message.mentions.users.first();
      const reason = args.slice(1).join(' ') || 'Sebep yok';
      if (!user) return message.reply('❌ Kullanıcı etiketle.');
      const member = await message.guild.members.fetch(user.id).catch(() => null);
      if (!member || !member.kickable) return message.reply('❌ Atamıyorum.');
      await member.kick(reason);
      return message.reply(`👢 **${user.tag}** atıldı.`);
    }

    if (command === 'mute') {
      if (!isMod(message.member)) return message.reply('❌ Yetkin yok.');
      const user = message.mentions.users.first();
      const sure = parseInt(args[1]) || 10;
      const reason = args.slice(2).join(' ') || 'Sebep yok';
      if (!user) return message.reply('❌ Kullanıcı etiketle.');
      const member = await message.guild.members.fetch(user.id).catch(() => null);
      if (!member) return message.reply('❌ Bulunamadı.');
      await member.timeout(sure * 60 * 1000, reason);
      return message.reply(`🔇 **${user.tag}** ${sure} dk susturuldu.`);
    }

    if (command === 'unmute') {
      if (!isMod(message.member)) return message.reply('❌ Yetkin yok.');
      const user = message.mentions.users.first();
      if (!user) return message.reply('❌ Kullanıcı etiketle.');
      const member = await message.guild.members.fetch(user.id).catch(() => null);
      if (!member) return message.reply('❌ Bulunamadı.');
      await member.timeout(null);
      return message.reply(`🔊 **${user.tag}** susturması kaldırıldı.`);
    }

    if (command === 'warn') {
      if (!isMod(message.member)) return message.reply('❌ Yetkin yok.');
      const user = message.mentions.users.first();
      const reason = args.slice(1).join(' ') || 'Sebep yok';
      if (!user) return message.reply('❌ Kullanıcı etiketle.');
      await user.send(`⚠️ **${message.guild.name}** sunucusunda uyarıldın.\nSebep: ${reason}`).catch(() => {});
      return message.reply(`⚠️ **${user.tag}** uyarıldı.`);
    }

    if (command === 'temizle') {
      if (!isMod(message.member)) return message.reply('❌ Yetkin yok.');
      const sayi = parseInt(args[0]);
      if (!sayi || sayi < 1 || sayi > 100) return message.reply('❌ 1-100 arası sayı gir.');
      await message.channel.bulkDelete(sayi, true);
      const msg = await message.channel.send(`🧹 **${sayi}** mesaj silindi.`);
      setTimeout(() => msg.delete().catch(() => {}), 3000);
    }

    if (command === 'slowmode') {
      if (!isMod(message.member)) return message.reply('❌ Yetkin yok.');
      const sure = parseInt(args[0]) || 0;
      await message.channel.setRateLimitPerUser(sure);
      return message.reply(`🐢 Slowmode: **${sure}s**`);
    }

    if (command === 'kilit') {
      if (!isMod(message.member)) return message.reply('❌ Yetkin yok.');
      await message.channel.permissionOverwrites.edit(message.guild.roles.everyone, { SendMessages: false });
      return message.reply('🔒 Kanal kilitlendi.');
    }

    if (command === 'kilit-aç') {
      if (!isMod(message.member)) return message.reply('❌ Yetkin yok.');
      await message.channel.permissionOverwrites.edit(message.guild.roles.everyone, { SendMessages: null });
      return message.reply('🔓 Kanal kilidi açıldı.');
    }

    // ============================
    // ÇEKİLİŞ
    // ============================
    if (command === 'çekiliş-başlat') {
      if (!isMod(message.member)) return message.reply('❌ Yetkin yok.');
      const sure = parseInt(args[0]);
      const kazananSayi = parseInt(args[1]);
      const odul = args.slice(2).join(' ');
      if (!sure || !kazananSayi || !odul)
        return message.reply('❌ Kullanım: `!çekiliş-başlat <süre dk> <kazanan> <ödül>`');

      const bitis = Date.now() + sure * 60 * 1000;
      const embed = new EmbedBuilder()
        .setTitle('🎉 ÇEKİLİŞ BAŞLADI!')
        .setDescription(`**Ödül:** ${odul}\n**Kazanan:** ${kazananSayi}\n**Bitiş:** <t:${Math.floor(bitis / 1000)}:R>\n\nKatılmak için 🎉 butonuna bas!`)
        .setColor(0x9B59B6)
        .setFooter({ text: `Başlatan: ${message.author.tag}` });

      const btn = new ButtonBuilder().setCustomId('cekilis_katil').setLabel('Katıl').setEmoji('🎉').setStyle(ButtonStyle.Primary);
      const row = new ActionRowBuilder().addComponents(btn);
      const msg = await message.channel.send({ embeds: [embed], components: [row] });

      const katilimcilar = new Set();
      const collector = msg.createMessageComponentCollector({ time: sure * 60 * 1000 });

      collector.on('collect', async (i) => {
        if (i.customId !== 'cekilis_katil') return;
        if (katilimcilar.has(i.user.id)) {
          katilimcilar.delete(i.user.id);
          return i.reply({ content: '❌ Çekilişten çekildin.', ephemeral: true });
        }
        katilimcilar.add(i.user.id);
        return i.reply({ content: '✅ Katıldın!', ephemeral: true });
      });

      collector.on('end', async () => {
        const arr = [...katilimcilar];
        if (arr.length === 0) return message.channel.send('❌ Kimse katılmadı.');
        const kazananlar = [];
        const kopya = [...arr];
        for (let i = 0; i < Math.min(kazananSayi, kopya.length); i++) {
          const idx = Math.floor(Math.random() * kopya.length);
          kazananlar.push(kopya.splice(idx, 1)[0]);
        }
        const endEmbed = new EmbedBuilder()
          .setTitle('🎉 ÇEKİLİŞ BİTTİ!')
          .setDescription(`**Ödül:** ${odul}\n\n**Kazananlar:**\n${kazananlar.map(id => `<@${id}>`).join('\n')}`)
          .setColor(0x57F287);
        const disabledRow = new ActionRowBuilder().addComponents(ButtonBuilder.from(btn).setDisabled(true));
        msg.edit({ embeds: [embed], components: [disabledRow] }).catch(() => {});
        message.channel.send({ content: kazananlar.map(id => `<@${id}>`).join(' '), embeds: [endEmbed] });
      });
    }

    // ============================
    // TICKET PANEL
    // ============================
    if (command === 'ticket-panel') {
      if (!message.member.permissions.has(PermissionFlagsBits.Administrator))
        return message.reply('❌ Yönetici yetkisi gerekli.');

      const embed = new EmbedBuilder()
        .setTitle('🎫 Pangea Destek Sistemi')
        .setDescription(
          'Aşağıdaki menüden bir **ticket kategorisi** seçerek yeni bir destek talebi oluşturabilirsin.\n\n' +
          '**Kategoriler:**\n' +
          Object.values(TICKET_TYPES).map(t => `${t.emoji} **${t.label}** - ${t.description}`).join('\n') +
          '\n\n⚠️ Gereksiz yere ticket açmak yasaktır.'
        )
        .setColor(0x5865F2)
        .setFooter({ text: 'Pangea Destek Sistemi', iconURL: client.user.displayAvatarURL() })
        .setTimestamp();

      const selectMenu = new StringSelectMenuBuilder()
        .setCustomId('ticket_select')
        .setPlaceholder('📂 Bir kategori seç...')
        .addOptions(
          Object.entries(TICKET_TYPES).map(([key, val]) =>
            new StringSelectMenuOptionBuilder()
              .setLabel(val.label)
              .setDescription(val.description)
              .setValue(key)
              .setEmoji(val.emoji)
          )
        );

      const row = new ActionRowBuilder().addComponents(selectMenu);
      return message.channel.send({ embeds: [embed], components: [row] });
    }

    // ---------- !kapat ----------
    if (command === 'kapat' || command === 'close') {
      if (!activeTickets.has(message.channel.id))
        return message.reply('❌ Bu kanal ticket değil.');
      const ticket = activeTickets.get(message.channel.id);
      if (ticket.owner !== message.author.id && !isStaff(message.member))
        return message.reply('❌ Yetkin yok.');

      // Yıldız değerlendirme butonları (sadece üstlenen varsa)
      if (ticket.claimedBy) {
        const rateRow = new ActionRowBuilder().addComponents(
          [1, 2, 3, 4, 5].map(n =>
            new ButtonBuilder()
              .setCustomId(`rate_${n}`)
              .setLabel(`${n} ⭐`)
              .setStyle(ButtonStyle.Secondary)
          )
        );
        await message.channel.send({
          content: `<@${ticket.owner}> lütfen yetkiliyi değerlendir:`,
          components: [rateRow]
        });
      }

      await message.reply({
        embeds: [new EmbedBuilder().setTitle('🔒 Kapatılıyor').setDescription('Transcript oluşturuluyor, 5 sn içinde kapanacak...').setColor(0xED4245)]
      });

      try {
        const result = await createTranscript(message.channel);
        if (result && config.transcriptChannel) {
          const tCh = message.guild.channels.cache.get(config.transcriptChannel);
          if (tCh) {
            const att = new AttachmentBuilder(result.filePath, { name: result.fileName });
            await tCh.send({
              content: `📄 **${message.channel.name}** transcriptı (Kapatan: ${message.author.tag})`,
              files: [att]
            });
          }
        }
        if (result) fs.unlink(result.filePath, () => {});
      } catch (e) { console.error(e); }

      config.stats.closedTickets++;
      activeTickets.delete(message.channel.id);
      saveActiveTickets();
      saveConfig();

      sendLog(message.guild, new EmbedBuilder().setTitle('🔒 Ticket Kapatıldı').setColor(0xED4245)
        .addFields(
          { name: 'Kanal', value: message.channel.name, inline: true },
          { name: 'Kapatan', value: message.author.tag, inline: true }
        ).setTimestamp());

      setTimeout(() => message.channel.delete().catch(() => {}), 5000);
    }
  } catch (err) {
    console.error('Komut hatası:', err);
  }
});

// ============================
// ETKİLEŞİMLER
// ============================
client.on(Events.InteractionCreate, async (interaction) => {
  try {
    // -------- Ticket Select --------
    if (interaction.isStringSelectMenu() && interaction.customId === 'ticket_select') {
      await interaction.deferReply({ ephemeral: true });

      const type = interaction.values[0];
      const data = TICKET_TYPES[type];
      if (!data) return interaction.editReply({ content: '❌ Geçersiz kategori.' });

      if (config.blacklist.includes(interaction.user.id))
        return interaction.editReply({ content: '🚫 Kara listedesin.' });

      // 1 kullanıcı = 1 ticket
      const existing = interaction.guild.channels.cache.find(
        c => activeTickets.has(c.id) && activeTickets.get(c.id).owner === interaction.user.id
      );
      if (existing)
        return interaction.editReply({ content: `❌ Zaten açık bir ticket'ın var: <#${existing.id}>` });

      const overwrites = [
        { id: interaction.guild.id, deny: [PermissionFlagsBits.ViewChannel] },
        {
          id: interaction.user.id,
          allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.AttachFiles]
        },
        {
          id: client.user.id,
          allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ManageChannels]
        }
      ];
      for (const rid of config.staffRoles) {
        overwrites.push({
          id: rid,
          allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.ManageMessages]
        });
      }

      const channel = await interaction.guild.channels.create({
        name: `ticket-${interaction.user.username}`.toLowerCase().slice(0, 90),
        type: ChannelType.GuildText,
        parent: config.ticketCategory || interaction.channel.parentId || null,
        permissionOverwrites: overwrites
      });

      activeTickets.set(channel.id, {
        owner: interaction.user.id,
        type,
        createdAt: Date.now(),
        claimedBy: null
      });
      saveActiveTickets();

      config.stats.totalTickets++;
      saveConfig();

      const ticketEmbed = new EmbedBuilder()
        .setTitle(`${data.emoji} ${data.label} Ticket`)
        .setDescription(
          `Merhaba <@${interaction.user.id}>! 👋\n\n` +
          `**Kategori:** ${data.emoji} ${data.label}\n` +
          `**Açan:** <@${interaction.user.id}>\n\n` +
          `Lütfen talebini detaylı yaz. Yetkililer en kısa sürede ilgilenecek.`
        )
        .setColor(data.color)
        .setTimestamp()
        .setFooter({ text: 'Pangea Destek Sistemi' });

      const claimBtn = new ButtonBuilder().setCustomId('ticket_claim').setLabel('Üstlen').setEmoji('✋').setStyle(ButtonStyle.Success);
      const closeBtn = new ButtonBuilder().setCustomId('ticket_close').setLabel('Kapat').setEmoji('🔒').setStyle(ButtonStyle.Danger);
      const row = new ActionRowBuilder().addComponents(claimBtn, closeBtn);

      const mentionStr = `<@${interaction.user.id}>` + (config.staffRoles.length ? ' ' + config.staffRoles.map(r => `<@&${r}>`).join(' ') : '');
      await channel.send({ content: mentionStr, embeds: [ticketEmbed], components: [row] });

      sendLog(interaction.guild, new EmbedBuilder().setTitle('🎫 Yeni Ticket').setColor(0x57F287)
        .addFields(
          { name: 'Açan', value: interaction.user.tag, inline: true },
          { name: 'Kategori', value: `${data.emoji} ${data.label}`, inline: true },
          { name: 'Kanal', value: `<#${channel.id}>`, inline: true }
        ).setTimestamp());

      return interaction.editReply({ content: `✅ Ticket'ın oluşturuldu: <#${channel.id}>` });
    }

    if (!interaction.isButton()) return;

    // -------- Ticket Kapat --------
    if (interaction.customId === 'ticket_close') {
      const ticket = activeTickets.get(interaction.channel.id);
      if (!ticket) return interaction.reply({ content: '❌ Bu kanal ticket değil.', ephemeral: true });
      if (ticket.owner !== interaction.user.id && !isStaff(interaction.member))
        return interaction.reply({ content: '❌ Yetkin yok.', ephemeral: true });

      await interaction.reply({
        embeds: [new EmbedBuilder().setTitle('🔒 Kapatılıyor').setDescription('Transcript oluşturuluyor...').setColor(0xED4245)]
      });

      try {
        const result = await createTranscript(interaction.channel);
        if (result && config.transcriptChannel) {
          const tCh = interaction.guild.channels.cache.get(config.transcriptChannel);
          if (tCh) {
            const att = new AttachmentBuilder(result.filePath, { name: result.fileName });
            await tCh.send({
              content: `📄 **${interaction.channel.name}** transcriptı (Kapatan: ${interaction.user.tag})`,
              files: [att]
            });
          }
        }
        if (result) fs.unlink(result.filePath, () => {});
      } catch (e) { console.error(e); }

      config.stats.closedTickets++;
      activeTickets.delete(interaction.channel.id);
      saveActiveTickets();
      saveConfig();
      setTimeout(() => interaction.channel.delete().catch(() => {}), 5000);
    }

    // -------- Ticket Claim --------
    if (interaction.customId === 'ticket_claim') {
      const ticket = activeTickets.get(interaction.channel.id);
      if (!ticket) return interaction.reply({ content: '❌ Bu kanal ticket değil.', ephemeral: true });
      if (!isStaff(interaction.member))
        return interaction.reply({ content: '❌ Sadece yetkililer üstlenebilir.', ephemeral: true });
      if (ticket.claimedBy)
        return interaction.reply({ content: `❌ Zaten <@${ticket.claimedBy}> üstlenmiş.`, ephemeral: true });

      ticket.claimedBy = interaction.user.id;
      activeTickets.set(interaction.channel.id, ticket);
      saveActiveTickets();

      config.stats.claims[interaction.user.id] = (config.stats.claims[interaction.user.id] || 0) + 1;
      saveConfig();

      return interaction.reply({ content: `✋ Ticket <@${interaction.user.id}> tarafından **üstlenildi**.` });
    }

    // -------- Değerlendirme --------
    if (interaction.customId.startsWith('rate_')) {
      const puan = parseInt(interaction.customId.split('_')[1]);
      const ticket = activeTickets.get(interaction.channel.id);
      if (!ticket || !ticket.claimedBy)
        return interaction.reply({ content: '❌ Değerlendirilecek yetkili yok.', ephemeral: true });
      if (ticket.owner !== interaction.user.id)
        return interaction.reply({ content: '❌ Sadece ticket sahibi değerlendirebilir.', ephemeral: true });

      const staffId = ticket.claimedBy;
      if (!config.stats.ratings[staffId]) config.stats.ratings[staffId] = { total: 0, count: 0 };
      config.stats.ratings[staffId].total += puan;
      config.stats.ratings[staffId].count += 1;
      saveConfig();

      return interaction.reply({ content: `⭐ Değerlendirmen için teşekkürler! **${puan}/5**`, ephemeral: true });
    }
  } catch (err) {
    console.error('Interaction hatası:', err);
  }
});

// ============================
// YAKALANMAYAN HATALAR
// ============================
process.on('unhandledRejection', (err) => console.error('Unhandled Rejection:', err));
process.on('uncaughtException', (err) => console.error('Uncaught Exception:', err));

// ============================
// GİRİŞ
// ============================
client.login(process.env.TOKEN);
