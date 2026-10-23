import request from 'supertest';
import app from '../src/app';
import {
  sequelize,
  User,
  Conversation,
  ChatMessage,
  initDb,
} from '../src/models';
import { generateToken } from '../src/utils/jwt';

describe('Chat Audio & Multi-Image Messaging (Send Status & Media Resolution)', () => {
  let userA: User;
  let userB: User;
  let tokenA: string;
  let convAB: Conversation;

  // Sample audio buffer (simulating mobile voice note)
  const sampleAudioBuffer = Buffer.from('RIFF$WAVEfmt \x10\x00\x00\x00\x01\x00\x01\x00D\xac\x00\x00\x88X\x01\x00\x02\x00\x10\x00data\x00\x00\x00\x00');

  // Sample image buffers
  const sampleJpegBuffer = Buffer.from([
    0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x01, 0x00, 0x60,
    0x00, 0x60, 0x00, 0x00, 0xff, 0xdb, 0x00, 0x43, 0x00, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x00, 0x01,
    0xff, 0xd9,
  ]);
  const samplePngBuffer = Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
    0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
  ]);

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    await initDb(true);
  });

  afterAll(async () => {
    await sequelize.close();
  });

  beforeEach(async () => {
    await ChatMessage.destroy({ where: {} });
    await Conversation.destroy({ where: {} });
    await User.destroy({ where: {} });

    userA = await User.create({
      username: 'alice_audio',
      email: 'alice_audio@flirttime.test',
      fullName: 'Alice Walker',
      firstName: 'Alice',
      lastName: 'Walker',
      dateOfBirth: '1998-04-12',
      isActive: true,
      role: 'user',
      isSubscribed: true,
    });

    userB = await User.create({
      username: 'bob_audio',
      email: 'bob_audio@flirttime.test',
      fullName: 'Bob Martin',
      firstName: 'Bob',
      lastName: 'Martin',
      dateOfBirth: '1996-09-24',
      isActive: true,
      role: 'user',
      isSubscribed: true,
    });

    tokenA = generateToken({
      id: userA.id,
      email: userA.email,
      role: userA.role,
    });

    const [u1, u2] = [userA.id, userB.id].sort();
    convAB = await Conversation.create({
      user1Id: u1,
      user2Id: u2,
      lastMessage: null,
      lastMessageAt: null,
      isDeletedForEveryone: false,
    });
  });

  describe('1. Audio Voice Note Messaging', () => {
    it('should upload direct audio file (multipart) and return status="sent", audioUrl and duration', async () => {
      const res = await request(app)
        .post(`/api/v1/chats/${convAB.id}/messages`)
        .set('Authorization', `Bearer ${tokenA}`)
        .field('messageType', 'audio')
        .field('duration', '9')
        .attach('file', sampleAudioBuffer, {
          filename: 'voice_recording.m4a',
          contentType: 'audio/m4a',
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.status).toBe('sent');
      expect(res.body.data.messageType).toBe('audio');
      expect(res.body.data.audioUrl).toBeDefined();
      expect(res.body.data.audioUrl).toContain('http');
      expect(res.body.data.duration).toBe(9);
      expect(res.body.data.metadata.audioUrl).toBe(res.body.data.audioUrl);
      expect(res.body.data.metadata.duration).toBe(9);

      // Verify conversation preview
      const conv = await Conversation.findByPk(convAB.id);
      expect(conv?.lastMessage).toBe('🎤 Voice message');
    });

    it('should support audio message sent via JSON body with audioUrl and duration', async () => {
      const res = await request(app)
        .post(`/api/v1/chats/${convAB.id}/messages`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          messageType: 'audio',
          audioUrl: 'https://s3.flirttime.test/chat/sample-audio.mp3',
          duration: 15,
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.status).toBe('sent');
      expect(res.body.data.messageType).toBe('audio');
      expect(res.body.data.audioUrl).toBeDefined();
      expect(res.body.data.duration).toBe(15);
    });

    it('should support sending audio to recipientId directly and return status="sent"', async () => {
      const res = await request(app)
        .post('/api/v1/chat/messages')
        .set('Authorization', `Bearer ${tokenA}`)
        .field('recipientId', userB.id)
        .field('messageType', 'audio')
        .field('duration', '12')
        .attach('audio', sampleAudioBuffer, {
          filename: 'recording.caf',
          contentType: 'audio/x-caf',
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.successCount).toBe(1);
      const msg = res.body.data.results[0].message;
      expect(msg.status).toBe('sent');
      expect(msg.messageType).toBe('audio');
      expect(msg.audioUrl).toBeDefined();
      expect(msg.duration).toBe(12);
    });
  });

  describe('2. Multi-Image Messaging', () => {
    it('should upload multiple images via multipart and return images array with status="sent"', async () => {
      const res = await request(app)
        .post(`/api/v1/chats/${convAB.id}/messages`)
        .set('Authorization', `Bearer ${tokenA}`)
        .attach('images', sampleJpegBuffer, 'photo1.jpg')
        .attach('images', samplePngBuffer, 'photo2.png');

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.status).toBe('sent');
      expect(res.body.data.messageType).toBe('image');
      expect(res.body.data.imageUrl).toBeDefined();
      expect(res.body.data.thumbnailUrl).toBeDefined();
      expect(Array.isArray(res.body.data.images)).toBe(true);
      expect(res.body.data.images.length).toBe(2);
      expect(res.body.data.images[0].url).toBeDefined();
      expect(res.body.data.images[1].url).toBeDefined();
    });

    it('should support multiple images passed via JSON body', async () => {
      const res = await request(app)
        .post(`/api/v1/chats/${convAB.id}/messages`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          messageType: 'image',
          images: [
            { url: 'https://s3.flirttime.test/chat/image1.jpg' },
            { url: 'https://s3.flirttime.test/chat/image2.jpg' },
          ],
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.status).toBe('sent');
      expect(res.body.data.messageType).toBe('image');
      expect(Array.isArray(res.body.data.images)).toBe(true);
      expect(res.body.data.images.length).toBe(2);
    });

    it('should reopen a deleted conversation when multiple images are sent', async () => {
      await convAB.update({
        isDeletedForEveryone: true,
        deletedForEveryoneAt: new Date(),
        deletedForEveryoneBy: userA.id,
      });

      const res = await request(app)
        .post(`/api/v1/chats/${convAB.id}/messages`)
        .set('Authorization', `Bearer ${tokenA}`)
        .attach('images', sampleJpegBuffer, 'photo1.jpg')
        .attach('images', samplePngBuffer, 'photo2.png');

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.messageType).toBe('image');
      expect(res.body.data.images.length).toBe(2);

      const conv = await Conversation.findByPk(convAB.id);
      expect(conv?.isDeletedForEveryone).toBe(false);
      expect(conv?.lastMessage).toBe('📷 Photo');
    });

    it('should return fully resolved images array and status in message history', async () => {
      // 1. Send multi-image
      await request(app)
        .post(`/api/v1/chats/${convAB.id}/messages`)
        .set('Authorization', `Bearer ${tokenA}`)
        .attach('images', sampleJpegBuffer, 'photo1.jpg')
        .attach('images', samplePngBuffer, 'photo2.png');

      // 2. Fetch history
      const res = await request(app)
        .get(`/api/v1/chats/${convAB.id}/messages`)
        .set('Authorization', `Bearer ${tokenA}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.messages.length).toBe(1);
      const fetchedMsg = res.body.data.messages[0];
      expect(fetchedMsg.status).toBe('sent');
      expect(fetchedMsg.messageType).toBe('image');
      expect(fetchedMsg.images.length).toBe(2);
      expect(fetchedMsg.medias.length).toBe(2);
      expect(new Set(fetchedMsg.images.map((img: any) => img.url || img.imageUrl)).size).toBe(2);
    });

    it('should support sending 3-4 images and have all of them visible in chat history', async () => {
      // Send 4 images
      const sendRes = await request(app)
        .post(`/api/v1/chats/${convAB.id}/messages`)
        .set('Authorization', `Bearer ${tokenA}`)
        .attach('images', sampleJpegBuffer, 'img1.jpg')
        .attach('images', samplePngBuffer, 'img2.png')
        .attach('images', sampleJpegBuffer, 'img3.jpg')
        .attach('images', samplePngBuffer, 'img4.png');

      expect(sendRes.status).toBe(201);
      expect(sendRes.body.success).toBe(true);
      expect(sendRes.body.data.images.length).toBe(4);
      expect(sendRes.body.data.imageUrls.length).toBe(4);
      expect(Array.isArray(sendRes.body.data.messages)).toBe(true);
      expect(sendRes.body.data.messages.length).toBe(1);
      expect(sendRes.body.data.messages[0].images.length).toBe(4);

      // Sender fetches history -> one grouped message with all 4 images
      const histSender = await request(app)
        .get(`/api/v1/chats/${convAB.id}/messages`)
        .set('Authorization', `Bearer ${tokenA}`);

      expect(histSender.status).toBe(200);
      expect(histSender.body.data.messages.length).toBe(1);
      expect(histSender.body.data.messages[0].messageType).toBe('image');
      expect(histSender.body.data.messages[0].images.length).toBe(4);
      expect(histSender.body.data.messages[0].status).toBe('sent');

      // Recipient (Bob) generates token and fetches history -> should also see all 4 images
      const tokenB = generateToken({
        id: userB.id,
        email: userB.email,
        role: userB.role,
      });

      const histRecipient = await request(app)
        .get(`/api/v1/chats/${convAB.id}/messages`)
        .set('Authorization', `Bearer ${tokenB}`);

      expect(histRecipient.status).toBe(200);
      expect(histRecipient.body.data.messages.length).toBe(1);
      expect(histRecipient.body.data.messages[0].messageType).toBe('image');
      expect(histRecipient.body.data.messages[0].images.length).toBe(4);
      expect(histRecipient.body.data.messages[0].medias.length).toBe(4);
      expect(histRecipient.body.data.messages[0].isMine).toBe(false);
    });

    it('should support sending 3-4 images AND audio in the same request without dropping either media', async () => {
      const sendRes = await request(app)
        .post(`/api/v1/chats/${convAB.id}/messages`)
        .set('Authorization', `Bearer ${tokenA}`)
        .field('duration', '14')
        .attach('images', sampleJpegBuffer, 'photo1.jpg')
        .attach('images', samplePngBuffer, 'photo2.png')
        .attach('images', sampleJpegBuffer, 'photo3.jpg')
        .attach('audio', sampleAudioBuffer, {
          filename: 'voice_memo.m4a',
          contentType: 'audio/m4a',
        });

      expect(sendRes.status).toBe(201);
      expect(sendRes.body.success).toBe(true);
      // Both images and audio messages are created
      expect(sendRes.body.data.images.length).toBe(3);
      expect(sendRes.body.data.audioUrl).toBeDefined();
      expect(sendRes.body.data.messages.length).toBe(2); // 1 image group + 1 audio

      // Fetch history -> grouped images plus the voice note
      const histRes = await request(app)
        .get(`/api/v1/chats/${convAB.id}/messages`)
        .set('Authorization', `Bearer ${tokenA}`);

      expect(histRes.status).toBe(200);
      expect(histRes.body.data.messages.length).toBe(2);

      const imageMsgs = histRes.body.data.messages.filter((m: any) => m.messageType === 'image');
      const audioMsgs = histRes.body.data.messages.filter((m: any) => m.messageType === 'audio');

      expect(imageMsgs.length).toBe(1);
      expect(imageMsgs[0].images.length).toBe(3);
      expect(audioMsgs.length).toBe(1);
      expect(audioMsgs[0].audioUrl).toBeDefined();
      expect(audioMsgs[0].duration).toBe(14);
    });
  });

  describe('3. Single Image Messaging with Status and Top-Level URLs', () => {
    it('should return status="sent", imageUrl, and thumbnailUrl for single image', async () => {
      const res = await request(app)
        .post(`/api/v1/chats/${convAB.id}/messages`)
        .set('Authorization', `Bearer ${tokenA}`)
        .attach('image', sampleJpegBuffer, 'single_photo.jpg');

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.status).toBe('sent');
      expect(res.body.data.messageType).toBe('image');
      expect(res.body.data.imageUrl).toBeDefined();
      expect(res.body.data.thumbnailUrl).toBeDefined();
    });
  });
});
