/**
 * Persistent task queue — in-memory with JSON disk backup.
 * No external dependencies.
 */
import fs from 'fs';
import path from 'path';
import os from 'os';
import { randomUUID } from 'crypto';

export class TaskQueue {
  constructor({ workdir }) {
    this.file = path.join(workdir, 'queue.json');
    this.tasks = [];        // { id, type, title, body, meta, status, attempts, created }
    this.load();
  }

  load() {
    try {
      this.tasks = JSON.parse(fs.readFileSync(this.file, 'utf8'));
    } catch {
      this.tasks = [];
    }
  }

  save() {
    fs.writeFileSync(this.file, JSON.stringify(this.tasks, null, 2));
  }

  push(task) {
    const t = {
      id: randomUUID(),
      type: task.type || 'generic',
      title: task.title,
      body: task.body || '',
      meta: task.meta || {},
      status: 'pending',
      attempts: 0,
      created: Date.now(),
    };
    this.tasks.push(t);
    this.save();
    return t;
  }

  /** Grab next pending task, mark it in-progress */
  claim() {
    const t = this.tasks.find(t => t.status === 'pending');
    if (!t) return null;
    t.status = 'running';
    t.attempts++;
    t.claimedAt = Date.now();
    this.save();
    return t;
  }

  complete(id, result = {}) {
    const t = this.tasks.find(t => t.id === id);
    if (t) { t.status = 'done'; t.result = result; t.doneAt = Date.now(); this.save(); }
  }

  fail(id, err = '') {
    const t = this.tasks.find(t => t.id === id);
    if (!t) return;
    if (t.attempts >= 2) {
      t.status = 'failed';
      t.error = err;
    } else {
      t.status = 'pending';  // re-queue for retry
    }
    this.save();
  }

  stats() {
    const counts = { pending: 0, running: 0, done: 0, failed: 0 };
    for (const t of this.tasks) counts[t.status] = (counts[t.status] || 0) + 1;
    return counts;
  }

  hasPending() {
    return this.tasks.some(t => t.status === 'pending');
  }

  pendingCount() {
    return this.tasks.filter(t => t.status === 'pending').length;
  }

  /** Prevent duplicate tasks with same title */
  has(title) {
    return this.tasks.some(t => t.title === title && t.status !== 'failed');
  }
}
