import { readFile } from 'fs';
import * as path from 'path';

export interface User {
  id: string;
  name: string;
}

export class UserService {
  private users: User[] = [];

  public addUser(user: User): void {
    this.users.push(user);
  }
}

export function getUserCount(service: UserService): number {
  return 42;
}

