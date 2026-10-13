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
  Events
} = require('discord.js');

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
  partner: {
    label: 'Partner',
    emoji: '🤝',
    description: 'Partnerlik başvurusu için ticket aç',
    color: 0x5865F2
  },
  merge: {
    label: 'Merge',
    emoji: '🔗',
    description: 'Merge (birleşme) talebi için ticket aç',
    color: 0x57F287
  },
  siege: {
    label: 'Siege',
    emoji: '⚔️',
    description: 'Siege (kuşatma) başvurusu için ticket aç',
    color: 0xED4245
  },
  sikayet: {
    label: 'Şikayet',
    emoji: '⚠️',
    description: 'Bir kullanıcıyı şikayet et',
    color: 0xFEE75C
  },
  destek: {
    label: 'Destek',
    emoji: '🛠️',
    description: 'Genel destek ve yardım için ticket aç',
    color: 0xEB459E
  },
  cekilis: {
    label: 'Çekiliş',
    emoji: '🎉',
    description: 'Çekiliş düzenlemek için ticket aç',
    color: 0x9B59B6
  }
};

// Ticket kanallarını takip etmek için (basit hafıza)
const activeTickets = new Map();

// ============================
// BOT HAZIR
// ============================
client.once(Events.ClientReady, () => {
  console.log(`✅ ${client.user.tag} olarak giriş yapıldı!`);
  client.user.setActivity('!yardım | Pangea', { type: 3 }); // 3 = WATCHING
});

// ============================
// MESAJ KOMUTLARI
// ============================
client.on(Events.MessageCreate, async (message) => {
  if (message.author.bot) return;
  if (!message.content.startsWith('!')) return;

  const args = message.content.slice(1).trim().split(/ +/);
  const command = args.shift().toLowerCase();

  // !yardım
  if (command === 'yardım' || command === 'help') {
    const embed = new EmbedBuilder()
      .setTitle('🌍 Pangea Bot - Komutlar')
      .setDescription('Aşağıda mevcut komutları bulabilirsin.')
      .setColor(0x5865F2)
      .addFields(
        { name: '📌 Genel', value: '`!yardım` - Bu mesajı gösterir\n`!ping` - Bot gecikmesini gösterir\n`!bilgi` - Bot hakkında bilgi' },
        { name: '🎫 Ticket', value: '`!ticket-panel` - Ticket panelini gönderir\n`!kapat` - Mevcut ticket\'ı kapatır' }
      )
      .setFooter({ text: 'Pangea Bot', iconURL: client.user.displayAvatarURL() })
      .setTimestamp();

    return message.reply({ embeds: [embed] });
  }

  // !ping
  if (command === 'ping') {
    const msg = await message.reply('🏓 Hesaplanıyor...');
    const latency = msg.createdTimestamp - message.createdTimestamp;
    msg.edit(`🏓 **Pong!**\n📡 Gecikme: \`${latency}ms\`\n💓 WebSocket: \`${client.ws.ping}ms\``);
  }

  // !bilgi
  if (command === 'bilgi') {
    const embed = new EmbedBuilder()
      .setTitle('🌍 Pangea Bot')
      .setDescription('Pangea, destek ve genel komutlar için tasarlanmış modern bir Discord botudur.')
      .setColor(0x5865F2)
      .addFields(
        { name: '📊 Sunucu Sayısı', value: `${client.guilds.cache.size}`, inline: true },
        { name: '👥 Kullanıcı Sayısı', value: `${client.users.cache.size}`, inline: true },
        { name: '📚 Kütüphane', value: 'discord.js v14', inline: true }
      )
      .setFooter({ text: 'Pangea • 2025' })
      .setTimestamp();

    return message.reply({ embeds: [embed] });
  }

  // !ticket-panel
  if (command === 'ticket-panel') {
    if (!message.member.permissions.has(PermissionFlagsBits.Administrator)) {
      return message.reply('❌ Bu komutu kullanmak için **Yönetici** yetkisine sahip olmalısın.');
    }

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

  // !kapat
  if (command === 'kapat' || command === 'close') {
    if (!activeTickets.has(message.channel.id)) {
      return message.reply('❌ Bu kanal bir ticket kanalı değil.');
    }

    const embed = new EmbedBuilder()
      .setTitle('🔒 Ticket Kapatılıyor')
      .setDescription('Bu ticket **5 saniye** içinde kapatılacak...')
      .setColor(0xED4245);

    await message.reply({ embeds: [embed] });
    setTimeout(() => {
      activeTickets.delete(message.channel.id);
      message.channel.delete().catch(() => {});
    }, 5000);
  }
});

// ============================
// ETKİLEŞİMLER (Select Menu + Butonlar)
// ============================
client.on(Events.InteractionCreate, async (interaction) => {
  // -------- Select Menu --------
  if (interaction.isStringSelectMenu() && interaction.customId === 'ticket_select') {
    await interaction.deferReply({ ephemeral: true });

    const type = interaction.values[0];
    const data = TICKET_TYPES[type];

    // Aynı kullanıcının açık ticket'ı var mı?
    const existing = interaction.guild.channels.cache.find(
      c => c.name === `ticket-${interaction.user.id}` && activeTickets.has(c.id)
    );

    if (existing) {
      return interaction.editReply({
        content: `❌ Zaten açık bir ticket'ın var: <#${existing.id}>`
      });
    }

    // Kanal oluştur
    const channel = await interaction.guild.channels.create({
      name: `ticket-${interaction.user.username}`.toLowerCase().slice(0, 90),
      type: ChannelType.GuildText,
      parent: interaction.channel.parentId || null,
      permissionOverwrites: [
        {
          id: interaction.guild.id,
          deny: [PermissionFlagsBits.ViewChannel]
        },
        {
          id: interaction.user.id,
          allow: [
            PermissionFlagsBits.ViewChannel,
            PermissionFlagsBits.SendMessages,
            PermissionFlagsBits.ReadMessageHistory,
            PermissionFlagsBits.AttachFiles
          ]
        },
        {
          id: client.user.id,
          allow: [
            PermissionFlagsBits.ViewChannel,
            PermissionFlagsBits.SendMessages,
            PermissionFlagsBits.ManageChannels
          ]
        }
      ]
    });

    activeTickets.set(channel.id, {
      owner: interaction.user.id,
      type: type,
      createdAt: Date.now()
    });

    // Ticket kanalına mesaj
    const ticketEmbed = new EmbedBuilder()
      .setTitle(`${data.emoji} ${data.label} Ticket`)
      .setDescription(
        `Merhaba <@${interaction.user.id}>! 👋\n\n` +
        `**Kategori:** ${data.emoji} ${data.label}\n` +
        `**Açan:** <@${interaction.user.id}>\n\n` +
        `Lütfen talebini detaylı bir şekilde yaz. Yetkililer en kısa sürede ilgilenecek.`
      )
      .setColor(data.color)
      .setTimestamp()
      .setFooter({ text: 'Pangea Destek Sistemi' });

    const closeButton = new ButtonBuilder()
      .setCustomId('ticket_close')
      .setLabel('Ticket\'ı Kapat')
      .setEmoji('🔒')
      .setStyle(ButtonStyle.Danger);

    const claimButton = new ButtonBuilder()
      .setCustomId('ticket_claim')
      .setLabel('Üstlen')
      .setEmoji('✋')
      .setStyle(ButtonStyle.Success);

    const row = new ActionRowBuilder().addComponents(claimButton, closeButton);

    await channel.send({
      content: `<@${interaction.user.id}>`,
      embeds: [ticketEmbed],
      components: [row]
    });

    return interaction.editReply({
      content: `✅ Ticket'ın oluşturuldu: <#${channel.id}>`
    });
  }

  // -------- Butonlar --------
  if (interaction.isButton()) {
    // Kapat butonu
    if (interaction.customId === 'ticket_close') {
      if (!activeTickets.has(interaction.channel.id)) {
        return interaction.reply({ content: '❌ Bu kanal bir ticket değil.', ephemeral: true });
      }

      const embed = new EmbedBuilder()
        .setTitle('🔒 Ticket Kapatılıyor')
        .setDescription(`Ticket, <@${interaction.user.id}> tarafından kapatılıyor...`)
        .setColor(0xED4245);

      await interaction.reply({ embeds: [embed] });
      activeTickets.delete(interaction.channel.id);
      setTimeout(() => interaction.channel.delete().catch(() => {}), 5000);
    }

    // Üstlen butonu
    if (interaction.customId === 'ticket_claim') {
      const ticket = activeTickets.get(interaction.channel.id);
      if (!ticket) {
        return interaction.reply({ content: '❌ Bu kanal bir ticket değil.', ephemeral: true });
      }

      await interaction.reply({
        content: `✋ Ticket <@${interaction.user.id}> tarafından **üstlenildi**.`,
      });
    }
  }
});

// ============================
// GİRİŞ
// ============================
client.login(process.env.TOKEN);
