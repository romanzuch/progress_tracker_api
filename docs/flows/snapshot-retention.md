# Raw Payload Retention (Pruning Job)

Covers `startSnapshotRetentionScheduler()` / `SnapshotRetention.service.pruneStalePayloads()` and the `npm run job:prune-snapshots` CLI entrypoint. See [character-history-query.md](../plans/prds/character-history-query.md).

Same shape as the scheduled snapshot-polling job (no diagram for that one yet, but see the "Scheduled character snapshots" section of the README for its behavior), with one important difference in intent: this job never calls Battle.net. It only trims local data, which is why it's enabled by default while the polling job is not.

```mermaid
sequenceDiagram
    autonumber
    participant Timer as setInterval heartbeat<br/>(SNAPSHOT_RETENTION_JOB_HEARTBEAT_HOURS)
    participant Sched as SnapshotRetentionScheduler.service
    participant Svc as SnapshotRetention.service
    participant Model as CharacterSnapshotModel
    participant DB as character_snapshots (Postgres)

    Note over Sched: startSnapshotRetentionScheduler() —<br/>no-op if SNAPSHOT_RETENTION_JOB_ENABLED=false

    Timer->>Sched: tick()
    alt previous run still in flight
        Sched-->>Timer: skip this tick (in-flight guard)
    else not running
        Sched->>Svc: pruneStalePayloads()
        Svc->>Svc: cutoff = now - SNAPSHOT_RAW_PAYLOAD_RETENTION_DAYS
        Svc->>Model: pruneRawPayloadsOlderThan(cutoff)
        Model->>DB: UPDATE character_snapshots<br/>SET profile_payload = NULL, achievements_payload = NULL,<br/>equipment_payload = NULL<br/>WHERE captured_at < cutoff AND profile_payload IS NOT NULL
        Note over Model,DB: the IS NOT NULL guard makes a repeated<br/>run against already-pruned rows a cheap no-op
        DB-->>Model: rows affected
        Model-->>Svc: prunedRows count
        alt pruneStalePayloads throws (DB blip, etc.)
            Svc-->>Sched: rejected promise
            Sched->>Sched: catch + log at the boundary — a run failing<br/>here must not crash the API process
        else success
            Svc-->>Sched: { prunedRows }
            Sched->>Sched: log summary
        end
    end
```

### Manual run (`npm run job:prune-snapshots`)

`scripts/run-snapshot-retention-job.ts` calls `connect()`, then `pruneStalePayloads()` directly (bypassing the scheduler entirely — no in-flight guard needed for a single one-shot invocation), logs `{ prunedRows }`, and exits `0`, or logs the error and exits `1`. It runs regardless of `SNAPSHOT_RETENTION_JOB_ENABLED`, mirroring `npm run job:snapshot`'s relationship to `SNAPSHOT_JOB_ENABLED`.
