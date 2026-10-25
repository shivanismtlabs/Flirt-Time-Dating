import request from 'supertest';
import app from '../src/app';
import {
  sequelize,
  User,
  Conversation,
  ChatMessage,
  UserBlock,
  initDb,
} from '../src/models';
import { generateToken } from '../src/utils/jwt';
import { chatService } from '../src/services/chat.service';

describe('FlirtTime Chat Attachments — Photo, Camera, Location & Contact', () => {
  let userA: User;
  let userB: User;
  let userC: User;
  let tokenA: string;
  let tokenB: string;
  let tokenC: string;
  let convAB: Conversation;

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
    await UserBlock.destroy({ where: {} });
    await User.destroy({ where: {} });

    userA = await User.create({
      username: 'alex_attachment',
      email: 'alex_att@example.com',
      fullName: 'Alex Morgan',
      firstName: 'Alex',
      lastName: 'Morgan',
      dateOfBirth: '1998-05-15',
      isActive: true,
      role: 'user',
    });

    userB = await User.create({
      username: 'jessica_attachment',
      email: 'jessica_att@example.com',
      fullName: 'Jessica Parker',
      firstName: 'Jessica',
      lastName: 'Parker',
      dateOfBirth: '2000-08-20',
      isActive: true,
      role: 'user',
    });

    userC = await User.create({
      username: 'amanda_attachment',
      email: 'amanda_att@example.com',
      fullName: 'Amanda Ross',
      firstName: 'Amanda',
      lastName: 'Ross',
      dateOfBirth: '1999-03-10',
      isActive: true,
      role: 'user',
    });

    tokenA = generateToken({ id: userA.id, email: userA.email, role: userA.role });
    tokenB = generateToken({ id: userB.id, email: userB.email, role: userB.role });
    tokenC = generateToken({ id: userC.id, email: userC.email, role: userC.role });

    convAB = await Conversation.create({
      user1Id: userA.id,
      user2Id: userB.id,
    });
  });

  // =========================================================================
  // 1. Photo & Camera S3 Presigned Upload Workflow
  // =========================================================================
  describe('1. Photo & Camera Presigned Upload (POST /api/v1/media/presigned-url)', () => {
    it('should generate a presigned upload URL for chat attachments with folder="chat"', async () => {
      const res = await request(app)
        .post('/api/v1/media/presigned-url')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          folder: 'chat',
          mimeType: 'image/jpeg',
          expiresInSeconds: 900,
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveProperty('uploadUrl');
      expect(res.body.data).toHaveProperty('key');
      expect(res.body.data).toHaveProperty('publicUrl');
      expect(res.body.data).toHaveProperty('thumbnailUrl');
      expect(res.body.data.key).toMatch(new RegExp(`^chat/${userA.id}/\\d+_[a-f0-9]+\\.jpg$`));
    });

    it('should reject unauthenticated upload URL requests with 401', async () => {
      const res = await request(app)
        .post('/api/v1/media/presigned-url')
        .send({ folder: 'chat', mimeType: 'image/jpeg' });

      expect(res.status).toBe(401);
    });

    it('should reject invalid folder or invalid MIME type with 400', async () => {
      const res = await request(app)
        .post('/api/v1/media/presigned-url')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          folder: 'invalid_folder',
          mimeType: 'text/html',
        });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });
  });

  // =========================================================================
  // 2. Photo Attachment Messaging
  // =========================================================================
  describe('2. Photo Attachment Message', () => {
    it('should send a photo message and automatically resolve thumbnail in metadata', async () => {
      const photoKey = `chat/${userA.id}/1700000000_abcdef1234567890abcdef.jpg`;

      const res = await request(app)
        .post(`/api/v1/chats/${convAB.id}/messages`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          messageType: 'image',
          content: photoKey,
          metadata: {
            width: 1080,
            height: 1920,
            mimeType: 'image/jpeg',
          },
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.messageType).toBe('image');
      expect(res.body.data.content).toBe(photoKey);
      expect(res.body.data.metadata).toHaveProperty('thumbnailUrl');
      expect(res.body.data.metadata.width).toBe(1080);
      expect(res.body.data.metadata.height).toBe(1920);

      // Verify conversation lastMessage preview
      const updatedConv = await Conversation.findByPk(convAB.id);
      expect(updatedConv?.lastMessage).toBe('📷 Photo');
    });

    it('should reject empty content for image message with 400', async () => {
      const res = await request(app)
        .post(`/api/v1/chats/${convAB.id}/messages`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          messageType: 'image',
          content: '',
        });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });
  });

  // =========================================================================
  // 3. Camera Attachment Messaging
  // =========================================================================
  describe('3. Camera Attachment Message (Reusing Photo Pipeline)', () => {
    it('should accept camera-captured image through same upload and message pipeline with source="camera"', async () => {
      const cameraKey = `chat/${userA.id}/1700000001_camera999.jpg`;

      const res = await request(app)
        .post(`/api/v1/chats/${convAB.id}/messages`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          messageType: 'image',
          content: cameraKey,
          metadata: {
            source: 'camera',
            fileSize: 1024000,
          },
        });

      expect(res.status).toBe(201);
      expect(res.body.data.messageType).toBe('image');
      expect(res.body.data.content).toBe(cameraKey);
      expect(res.body.data.metadata.source).toBe('camera');

      const updatedConv = await Conversation.findByPk(convAB.id);
      expect(updatedConv?.lastMessage).toBe('📷 Photo');
    });
  });

  // =========================================================================
  // 4. Attachment Ownership Verification (Security)
  // =========================================================================
  describe('4. Attachment Ownership Verification', () => {
    it('should reject attaching an image uploaded by another user with 403 ATTACHMENT_OWNERSHIP_INVALID', async () => {
      // User B's photo key
      const userBPhotoKey = `chat/${userB.id}/1700000002_userb_photo.jpg`;

      // User A attempts to attach User B's photo
      const res = await request(app)
        .post(`/api/v1/chats/${convAB.id}/messages`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          messageType: 'image',
          content: userBPhotoKey,
        });

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toContain('belonging to another user');
    });

    it('should reject attaching another user photo from photos or uploads folder', async () => {
      const userCKey = `uploads/${userC.id}/1700000003_private.jpg`;

      const res = await request(app)
        .post(`/api/v1/chats/${convAB.id}/messages`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          messageType: 'image',
          content: userCKey,
        });

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
    });
  });

  // =========================================================================
  // 5. Location Sharing
  // =========================================================================
  describe('5. Location Sharing Message', () => {
    it('should share valid location coordinates and format lastMessage preview', async () => {
      const res = await request(app)
        .post(`/api/v1/chats/${convAB.id}/messages`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          messageType: 'location',
          metadata: {
            latitude: 37.7749,
            longitude: -122.4194,
            name: 'Union Square, SF',
            address: '333 Post St, San Francisco, CA 94108',
          },
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.messageType).toBe('location');
      expect(res.body.data.metadata.latitude).toBe(37.7749);
      expect(res.body.data.metadata.longitude).toBe(-122.4194);
      expect(res.body.data.metadata.name).toBe('Union Square, SF');
      expect(res.body.data.content).toBe('📍 Union Square, SF');

      const updatedConv = await Conversation.findByPk(convAB.id);
      expect(updatedConv?.lastMessage).toBe('📍 Union Square, SF');
    });

    it('should default content and lastMessage to coordinates when location name is omitted', async () => {
      const res = await request(app)
        .post(`/api/v1/chats/${convAB.id}/messages`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          messageType: 'location',
          metadata: {
            latitude: 40.7128,
            longitude: -74.006,
          },
        });

      expect(res.status).toBe(201);
      expect(res.body.data.content).toBe('📍 Location (40.7128, -74.0060)');

      const updatedConv = await Conversation.findByPk(convAB.id);
      expect(updatedConv?.lastMessage).toBe('📍 Location');
    });

    it('should keep a single bubble when the same location is sent twice at once', async () => {
      const body = {
        messageType: 'location',
        content: 'Mumbai',
        metadata: {
          latitude: 19.076,
          longitude: 72.8777,
          name: 'Mumbai',
          address: 'Mumbai, Maharashtra',
        },
      };
      const otherPlace = {
        messageType: 'location',
        metadata: {
          latitude: 28.6139,
          longitude: 77.209,
          name: 'Delhi',
        },
      };

      const [first, second] = await Promise.all([
        request(app)
          .post(`/api/v1/chats/${convAB.id}/messages`)
          .set('Authorization', `Bearer ${tokenA}`)
          .send(body),
        request(app)
          .post(`/api/v1/chats/${convAB.id}/messages`)
          .set('Authorization', `Bearer ${tokenA}`)
          .send({
            messageType: 'location',
            metadata: {
              latitude: 19.076,
              longitude: 72.8777,
              name: 'Mumbai',
            },
          }),
      ]);

      expect(first.status).toBe(201);
      expect(second.status).toBe(201);
      expect(second.body.data.id).toBe(first.body.data.id);
      expect(first.body.data.messageType).toBe('location');

      const again = await request(app)
        .post(`/api/v1/chats/${convAB.id}/messages`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send(otherPlace);

      expect(again.status).toBe(201);
      expect(again.body.data.id).not.toBe(first.body.data.id);

      const count = await ChatMessage.count({
        where: { conversationId: convAB.id, messageType: 'location' },
      });
      expect(count).toBe(2);
    });
  });

  // =========================================================================
  // 6. Location Validation
  // =========================================================================
  describe('6. Location Coordinate Validation', () => {
    it('should reject out-of-range latitude (> 90) with 400', async () => {
      const res = await request(app)
        .post(`/api/v1/chats/${convAB.id}/messages`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          messageType: 'location',
          metadata: {
            latitude: 95.5,
            longitude: 50.0,
          },
        });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    it('should reject out-of-range longitude (> 180) with 400', async () => {
      const res = await request(app)
        .post(`/api/v1/chats/${convAB.id}/messages`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          messageType: 'location',
          metadata: {
            latitude: 45.0,
            longitude: 195.0,
          },
        });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    it('should reject non-finite coordinates (NaN or string) with 400', async () => {
      const res = await request(app)
        .post(`/api/v1/chats/${convAB.id}/messages`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          messageType: 'location',
          metadata: {
            latitude: 'invalid_lat',
            longitude: -122.4,
          },
        });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    it('should reject missing metadata for location message with 400', async () => {
      const res = await request(app)
        .post(`/api/v1/chats/${convAB.id}/messages`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          messageType: 'location',
        });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    it('should reject unknown/redundant alias keys in location metadata (e.g. lat, lng)', async () => {
      const res = await request(app)
        .post(`/api/v1/chats/${convAB.id}/messages`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          messageType: 'location',
          metadata: {
            latitude: 37.77,
            longitude: -122.41,
            lat: 37.77, // duplicate alias
            lng: -122.41, // duplicate alias
          },
        });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });
  });

  // =========================================================================
  // 7. Contact Sharing
  // =========================================================================
  describe('7. Contact Sharing Message', () => {
    it('should share selected contact card and format lastMessage preview', async () => {
      const res = await request(app)
        .post(`/api/v1/chats/${convAB.id}/messages`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          messageType: 'contact',
          metadata: {
            name: 'Sarah Connor',
            phoneNumber: '+1-555-0199',
            email: 'sarah.connor@example.com',
          },
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.messageType).toBe('contact');
      expect(res.body.data.metadata.name).toBe('Sarah Connor');
      expect(res.body.data.metadata.phoneNumber).toBe('+1-555-0199');
      expect(res.body.data.metadata.email).toBe('sarah.connor@example.com');
      expect(res.body.data.content).toBe('👤 Sarah Connor');

      const updatedConv = await Conversation.findByPk(convAB.id);
      expect(updatedConv?.lastMessage).toBe('👤 Sarah Connor');
    });

    it('should keep a single bubble when the same contact is sent twice at once', async () => {
      const body = {
        messageType: 'contact',
        metadata: {
          name: 'Aasha',
          phone: '+917974038791',
          contact: { name: 'Aasha', phoneNumber: '+917974038791' },
        },
      };

      const [first, second] = await Promise.all([
        request(app)
          .post(`/api/v1/chats/${convAB.id}/messages`)
          .set('Authorization', `Bearer ${tokenA}`)
          .send(body),
        request(app)
          .post(`/api/v1/chats/${convAB.id}/messages`)
          .set('Authorization', `Bearer ${tokenA}`)
          .send(body),
      ]);

      expect(first.status).toBe(201);
      expect(second.status).toBe(201);
      expect(second.body.data.id).toBe(first.body.data.id);
      expect(first.body.data.metadata.contact).toBeUndefined();
      expect(first.body.data.metadata.phone).toBeUndefined();
      expect(first.body.data.metadata.phoneNumber).toBe('+917974038791');

      const count = await ChatMessage.count({
        where: { conversationId: convAB.id, messageType: 'contact' },
      });
      expect(count).toBe(1);
    });
  });

  // =========================================================================
  // 8. Contact Validation & Anti-Bulk Address Book Protection
  // =========================================================================
  describe('8. Contact Validation & Address Book Security', () => {
    it('should reject missing or empty contact name with 400', async () => {
      const res = await request(app)
        .post(`/api/v1/chats/${convAB.id}/messages`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          messageType: 'contact',
          metadata: {
            name: '   ',
            phoneNumber: '+15550199',
          },
        });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    it('should reject missing or too short phoneNumber with 400', async () => {
      const res = await request(app)
        .post(`/api/v1/chats/${convAB.id}/messages`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          messageType: 'contact',
          metadata: {
            name: 'Valid Name',
            phoneNumber: '1',
          },
        });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    it('should reject invalid email format in contact metadata with 400', async () => {
      const res = await request(app)
        .post(`/api/v1/chats/${convAB.id}/messages`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          messageType: 'contact',
          metadata: {
            name: 'Valid Name',
            phoneNumber: '+15550199',
            email: 'not-an-email',
          },
        });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    it('should reject bulk contact dumps or unexpected properties in contact metadata', async () => {
      const res = await request(app)
        .post(`/api/v1/chats/${convAB.id}/messages`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          messageType: 'contact',
          metadata: {
            name: 'Valid Name',
            phoneNumber: '+15550199',
            allContacts: [{ name: 'Contact 1' }, { name: 'Contact 2' }], // Bulk dump attempt
          },
        });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });
  });

  // =========================================================================
  // 9. Authorization, Blocking & Idempotency
  // =========================================================================
  describe('9. Unified Messaging Authorization & Idempotency', () => {
    it('should reject sending messages from non-participants with 403', async () => {
      const res = await request(app)
        .post(`/api/v1/chats/${convAB.id}/messages`)
        .set('Authorization', `Bearer ${tokenC}`) // User C is not in convAB
        .send({
          messageType: 'location',
          metadata: { latitude: 37.77, longitude: -122.41 },
        });

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
    });

    it('should reject sending messages between blocked users with 403', async () => {
      // User B blocks User A
      await UserBlock.create({ userId: userB.id, blockedUserId: userA.id });

      const res = await request(app)
        .post(`/api/v1/chats/${convAB.id}/messages`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          messageType: 'contact',
          metadata: { name: 'Bob', phoneNumber: '+1234567890' },
        });

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
    });

    it('should be idempotent on message retry using clientMessageId', async () => {
      const clientMessageId = 'a1b2c3d4-e5f6-7a8b-9c0d-1e2f3a4b5c6d';

      const res1 = await request(app)
        .post(`/api/v1/chats/${convAB.id}/messages`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          clientMessageId,
          messageType: 'location',
          metadata: { latitude: 51.5074, longitude: -0.1278, name: 'London Eye' },
        });

      expect(res1.status).toBe(201);
      const msg1Id = res1.body.data.id;

      // Retry identical message with same clientMessageId
      const res2 = await request(app)
        .post(`/api/v1/chats/${convAB.id}/messages`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          clientMessageId,
          messageType: 'location',
          metadata: { latitude: 51.5074, longitude: -0.1278, name: 'London Eye' },
        });

      expect(res2.status).toBe(201);
      expect(res2.body.data.id).toBe(msg1Id);

      // Verify only 1 record created in database
      const count = await ChatMessage.count({ where: { conversationId: convAB.id } });
      expect(count).toBe(1);
    });
  });

  // =========================================================================
  // 10. Canonical Response Contract Verification
  // =========================================================================
  describe('10. Canonical Contract & No-Duplicate Keys Verification', () => {
    it('should conform strictly to standard response envelope with no duplicate aliases', async () => {
      const res = await request(app)
        .post(`/api/v1/chats/${convAB.id}/messages`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          messageType: 'contact',
          metadata: { name: 'Alice Smith', phoneNumber: '+1987654321' },
        });

      expect(res.status).toBe(201);
      expect(res.body).toEqual({
        success: true,
        message: 'Message sent successfully',
        data: expect.objectContaining({
          id: expect.any(String),
          conversationId: convAB.id,
          senderId: userA.id,
          recipientId: userB.id,
          content: '👤 Alice Smith',
          messageType: 'contact',
          metadata: expect.objectContaining({
            name: 'Alice Smith',
            phoneNumber: '+1987654321',
          }),
          isRead: false,
          sentAt: expect.any(String),
          isMine: true,
        }),
      });

      const data = res.body.data;
      // Assert absence of duplicate aliases
      expect(data.messageId).toBeUndefined();
      expect(data.message_id).toBeUndefined();
      expect(data.imageUrl).toBeUndefined();
      expect(data.mediaUrl).toBeUndefined();
      expect(data.metadata.lat).toBeUndefined();
      expect(data.metadata.lng).toBeUndefined();
      expect(data.metadata.sharedContact).toBeUndefined();
    });

    it('should correctly paginate and return attachment messages in history', async () => {
      // Send photo, location, contact, text
      await chatService.sendMessage(userA.id, convAB.id, {
        messageType: 'image',
        content: `chat/${userA.id}/photo1.jpg`,
      });
      await chatService.sendMessage(userA.id, convAB.id, {
        messageType: 'location',
        metadata: { latitude: 19.076, longitude: 72.8777, name: 'Mumbai' },
      });
      await chatService.sendMessage(userB.id, convAB.id, {
        messageType: 'contact',
        metadata: { name: 'Emergency Contact', phoneNumber: '+919999999999' },
      });

      const res = await request(app)
        .get(`/api/v1/chats/${convAB.id}/messages`)
        .set('Authorization', `Bearer ${tokenA}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.messages).toHaveLength(3);
      expect(res.body.data.messages[0].messageType).toBe('image');
      expect(res.body.data.messages[1].messageType).toBe('location');
      expect(res.body.data.messages[2].messageType).toBe('contact');
    });
  });
});
