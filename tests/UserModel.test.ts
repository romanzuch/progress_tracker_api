import { describe, expect, it } from 'vitest';
import { UserModel } from '../app/models/User.model.js';

describe('UserModel', () => {
  it('creates and lists users', () => {
    const user = UserModel.create({ name: 'Ada', email: 'ada@example.com' });
    expect(user.id).toBeDefined();
    expect(UserModel.findAll()).toContainEqual(user);
  });
});
