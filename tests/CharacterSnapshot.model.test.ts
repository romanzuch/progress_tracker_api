import { beforeEach, describe, expect, it, vi } from 'vitest';
import { asc, desc, eq, gte, isNotNull, lt, lte } from 'drizzle-orm';
import { characterSnapshots } from '../app/database/schema/index.js';

const { getDbMock } = vi.hoisted(() => ({ getDbMock: vi.fn() }));

vi.mock('../app/database/index.js', () => ({ getDb: getDbMock }));

// Spy on the real operators (rather than stubbing them) so assertions verify
// actual call arguments — e.g. that ownership scoping really uses
// characterSnapshots.userId — without having to decode generated SQL.
vi.mock('drizzle-orm', async (importOriginal) => {
  const actual = await importOriginal<typeof import('drizzle-orm')>();
  return {
    ...actual,
    eq: vi.fn(actual.eq),
    and: vi.fn(actual.and),
    gte: vi.fn(actual.gte),
    lte: vi.fn(actual.lte),
    lt: vi.fn(actual.lt),
    isNotNull: vi.fn(actual.isNotNull),
    asc: vi.fn(actual.asc),
    desc: vi.fn(actual.desc),
  };
});

const { CharacterSnapshotModel } = await import(
  '../app/models/CharacterSnapshot.model.js'
);

// A chainable stand-in for drizzle's query builder: every non-terminal
// method returns the same chain object, and the two possible terminal calls
// (`limit` for selects, `returning` for insert/update) resolve to whatever
// the test configures.
function createChain(terminalValue: unknown): Record<string, ReturnType<typeof vi.fn>> {
  const chain: Record<string, ReturnType<typeof vi.fn>> = {};
  for (const method of ['select', 'from', 'where', 'orderBy', 'update', 'set']) {
    chain[method] = vi.fn().mockReturnValue(chain);
  }
  chain.limit = vi.fn().mockReturnValue(terminalValue);
  chain.returning = vi.fn().mockReturnValue(terminalValue);
  return chain;
}

const IDENTITY = {
  userId: 'user-1',
  realmSlug: 'dun-morogh',
  characterName: 'sixfootfour',
};

describe('CharacterSnapshotModel.listHistory', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('selects only typed metric columns, never the raw jsonb payloads', async () => {
    const chain = createChain([]);
    getDbMock.mockReturnValue(chain);

    await CharacterSnapshotModel.listHistory({ ...IDENTITY, limit: 100 });

    const selected = chain.select.mock.calls[0][0] as Record<string, unknown>;
    expect(selected).not.toHaveProperty('profilePayload');
    expect(selected).not.toHaveProperty('achievementsPayload');
    expect(selected).not.toHaveProperty('equipmentPayload');
    expect(selected.id).toBe(characterSnapshots.id);
    expect(selected.level).toBe(characterSnapshots.level);
  });

  it('scopes strictly to the given user, realm, and character', async () => {
    const chain = createChain([]);
    getDbMock.mockReturnValue(chain);

    await CharacterSnapshotModel.listHistory({ ...IDENTITY, limit: 100 });

    expect(eq).toHaveBeenCalledWith(characterSnapshots.userId, 'user-1');
    expect(eq).toHaveBeenCalledWith(
      characterSnapshots.realmSlug,
      'dun-morogh',
    );
    expect(eq).toHaveBeenCalledWith(
      characterSnapshots.characterName,
      'sixfootfour',
    );
  });

  it('orders results chronologically ascending and applies the given limit', async () => {
    const rows = [{ id: 'a' }, { id: 'b' }];
    const chain = createChain(rows);
    getDbMock.mockReturnValue(chain);

    const result = await CharacterSnapshotModel.listHistory({
      ...IDENTITY,
      limit: 50,
    });

    expect(asc).toHaveBeenCalledWith(characterSnapshots.capturedAt);
    expect(chain.limit).toHaveBeenCalledWith(50);
    expect(result).toBe(rows);
  });

  it('applies from/to as inclusive date-range bounds only when provided', async () => {
    const chain = createChain([]);
    getDbMock.mockReturnValue(chain);
    const from = new Date('2026-01-01T00:00:00Z');
    const to = new Date('2026-02-01T00:00:00Z');

    await CharacterSnapshotModel.listHistory({
      ...IDENTITY,
      from,
      to,
      limit: 100,
    });

    expect(gte).toHaveBeenCalledWith(characterSnapshots.capturedAt, from);
    expect(lte).toHaveBeenCalledWith(characterSnapshots.capturedAt, to);
  });

  it('omits date-range conditions entirely when from/to are not given', async () => {
    const chain = createChain([]);
    getDbMock.mockReturnValue(chain);

    await CharacterSnapshotModel.listHistory({ ...IDENTITY, limit: 100 });

    expect(gte).not.toHaveBeenCalled();
    expect(lte).not.toHaveBeenCalled();
  });
});

describe('CharacterSnapshotModel.findLatest', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns the most recent snapshot for the owning user', async () => {
    const row = { id: 'snap-1', level: 80 };
    const chain = createChain([row]);
    getDbMock.mockReturnValue(chain);

    const result = await CharacterSnapshotModel.findLatest(IDENTITY);

    expect(eq).toHaveBeenCalledWith(characterSnapshots.userId, 'user-1');
    expect(desc).toHaveBeenCalledWith(characterSnapshots.capturedAt);
    expect(chain.limit).toHaveBeenCalledWith(1);
    expect(result).toBe(row);
  });

  it('returns undefined instead of a 404 signal when there is no snapshot', async () => {
    const chain = createChain([]);
    getDbMock.mockReturnValue(chain);

    const result = await CharacterSnapshotModel.findLatest(IDENTITY);

    expect(result).toBeUndefined();
  });
});

describe('CharacterSnapshotModel.pruneRawPayloadsOlderThan', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('nulls all three raw payload columns and leaves metrics untouched', async () => {
    const chain = createChain([{ id: 'snap-1' }, { id: 'snap-2' }]);
    getDbMock.mockReturnValue(chain);
    const cutoff = new Date('2026-04-01T00:00:00Z');

    const prunedCount =
      await CharacterSnapshotModel.pruneRawPayloadsOlderThan(cutoff);

    expect(chain.set).toHaveBeenCalledWith({
      profilePayload: null,
      achievementsPayload: null,
      equipmentPayload: null,
    });
    expect(prunedCount).toBe(2);
  });

  it('only targets snapshots older than the cutoff that still have a payload', async () => {
    const chain = createChain([]);
    getDbMock.mockReturnValue(chain);
    const cutoff = new Date('2026-04-01T00:00:00Z');

    await CharacterSnapshotModel.pruneRawPayloadsOlderThan(cutoff);

    expect(lt).toHaveBeenCalledWith(characterSnapshots.capturedAt, cutoff);
    expect(isNotNull).toHaveBeenCalledWith(characterSnapshots.profilePayload);
  });

  it('is a no-op returning 0 when nothing matches', async () => {
    const chain = createChain([]);
    getDbMock.mockReturnValue(chain);

    const prunedCount = await CharacterSnapshotModel.pruneRawPayloadsOlderThan(
      new Date(),
    );

    expect(prunedCount).toBe(0);
  });
});
