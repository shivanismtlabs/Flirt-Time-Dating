import { initDb, sequelize, User, UserIdentity } from '../src/models';

describe('UserIdentity Model & Sign in with Apple Database Specs', () => {
  beforeAll(async () => {
    await initDb(true);
  });

  beforeEach(async () => {
    await UserIdentity.destroy({ where: {}, truncate: true });
    await User.destroy({ where: {}, truncate: true });
  });

  afterAll(async () => {
    await sequelize.close();
  });

  it('should store Apple user identifier (sub), provider, and Apple private relay email', async () => {
    const user = await User.create({
      username: 'apple_user_1',
      email: 'privaterelay123@privaterelay.appleid.com',
    });

    const identity = await UserIdentity.create({
      userId: user.id,
      provider: 'apple',
      providerUserId: '001234.567890abcdef.1020',
      email: 'privaterelay123@privaterelay.appleid.com',
      isPrivateEmail: true,
    });

    expect(identity.id).toBeDefined();
    expect(identity.userId).toBe(user.id);
    expect(identity.provider).toBe('apple');
    expect(identity.providerUserId).toBe('001234.567890abcdef.1020');
    expect(identity.email).toBe('privaterelay123@privaterelay.appleid.com');
    expect(identity.isPrivateEmail).toBe(true);
  });

  it('should link an Apple identity to an existing user account', async () => {
    // Existing user registered via email
    const existingUser = await User.create({
      username: 'existing_user',
      email: 'existing.user@example.com',
    });

    // Linking Apple identity to existing account
    const appleIdentity = await UserIdentity.create({
      userId: existingUser.id,
      provider: 'apple',
      providerUserId: 'apple_sub_9999',
      email: 'existing.user@example.com',
      isPrivateEmail: false,
    });

    const fetchedUser = await User.findByPk(existingUser.id, {
      include: [{ model: UserIdentity, as: 'identities' }],
    });

    expect(fetchedUser).not.toBeNull();
    expect(fetchedUser?.identities).toHaveLength(1);
    expect(fetchedUser?.identities?.[0].providerUserId).toBe('apple_sub_9999');

    const fetchedIdentity = await UserIdentity.findOne({
      where: { provider: 'apple', providerUserId: 'apple_sub_9999' },
      include: [{ model: User, as: 'user' }],
    });

    expect(fetchedIdentity?.user?.id).toBe(existingUser.id);
    expect(fetchedIdentity?.user?.email).toBe('existing.user@example.com');
  });

  it('should enforce unique constraint on (provider, providerUserId)', async () => {
    const user1 = await User.create({ username: 'user_one' });
    const user2 = await User.create({ username: 'user_two' });

    await UserIdentity.create({
      userId: user1.id,
      provider: 'apple',
      providerUserId: 'duplicate_apple_sub',
    });

    // Attempting to register the same Apple user ID under another user must fail
    await expect(
      UserIdentity.create({
        userId: user2.id,
        provider: 'apple',
        providerUserId: 'duplicate_apple_sub',
      })
    ).rejects.toThrow();
  });

  it('should cascade delete user identities when user is deleted', async () => {
    const user = await User.create({ username: 'user_to_delete' });

    await UserIdentity.create({
      userId: user.id,
      provider: 'apple',
      providerUserId: 'apple_sub_to_delete',
    });

    await user.destroy();

    const identityCount = await UserIdentity.count({
      where: { providerUserId: 'apple_sub_to_delete' },
    });
    expect(identityCount).toBe(0);
  });
});
