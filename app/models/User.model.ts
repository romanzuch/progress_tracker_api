import { randomUUID } from 'node:crypto';

export interface User {
  id: string;
  name: string;
  email: string;
}

const users: User[] = [];

export const UserModel = {
  findAll(): User[] {
    return users;
  },
  create(user: Omit<User, 'id'>): User {
    const created: User = { id: randomUUID(), ...user };
    users.push(created);
    return created;
  },
};
