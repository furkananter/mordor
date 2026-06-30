import { FormEvent, useState } from "react";
import { Database, FolderOpen, HardDrive, Server, X } from "lucide-react";
import {
  CassandraConnectionDraft,
  ConnectionDraft,
  PostgresConnectionDraft,
  ProfileType,
  RedisConnectionDraft,
  SshConnectionDraft
} from "../../../core/config/profile";
import { ProfileListItem } from "../../../core/ipc";
import { Button } from "../../components/ui/Button";

const cassandraDefault: CassandraConnectionDraft = {
  type: "cassandra",
  name: "",
  contactPoints: "127.0.0.1",
  port: "9042",
  localDataCenter: "datacenter1",
  keyspace: "",
  username: "",
  password: "",
  useTls: false,
  migrationsFolder: "",
  migrationsKeyspace: ""
};

const redisDefault: RedisConnectionDraft = {
  type: "redis",
  name: "",
  host: "127.0.0.1",
  port: "6379",
  db: "0",
  username: "",
  password: "",
  useTls: false
};

const postgresDefault: PostgresConnectionDraft = {
  type: "postgres",
  name: "",
  host: "127.0.0.1",
  port: "5432",
  database: "postgres",
  username: "postgres",
  password: "",
  useTls: false,
  connectionString: ""
};

const sshDraftDefault: SshConnectionDraft = {
  enabled: false,
  host: "",
  port: "22",
  username: "",
  authKind: "password",
  password: "",
  privateKeyPath: "",
  passphrase: ""
};

function sshDraftFromProfile(ssh: ProfileListItem["ssh"]): SshConnectionDraft {
  if (!ssh) return sshDraftDefault;
  const draft: SshConnectionDraft = {
    enabled: true,
    host: ssh.host,
    port: String(ssh.port),
    username: ssh.username,
    authKind: ssh.auth.kind,
    // Secrets are never sent to the renderer — leave blank ("keep" on edit).
    password: "",
    passphrase: ""
  };
  if (ssh.auth.privateKeyPath) draft.privateKeyPath = ssh.auth.privateKeyPath;
  return draft;
}

function defaultForType(type: ProfileType): ConnectionDraft {
  switch (type) {
    case "cassandra":
      return cassandraDefault;
    case "redis":
      return redisDefault;
    case "postgres":
      return postgresDefault;
  }
}

function draftFromProfile(profile: ProfileListItem): ConnectionDraft {
  if (profile.type === "redis") {
    return {
      type: "redis",
      name: profile.name,
      host: profile.host,
      port: String(profile.port),
      db: String(profile.db),
      username: profile.username ?? "",
      password: "",
      useTls: profile.useTls,
      ssh: sshDraftFromProfile(profile.ssh)
    };
  }
  if (profile.type === "postgres") {
    const draft: PostgresConnectionDraft = {
      type: "postgres",
      name: profile.name,
      host: profile.host,
      port: String(profile.port),
      database: profile.database,
      username: profile.username ?? "",
      password: "",
      useTls: profile.useTls,
      connectionString: "",
      ssh: sshDraftFromProfile(profile.ssh)
    };
    if (profile.sslMode) draft.sslMode = profile.sslMode;
    return draft;
  }
  return {
    type: "cassandra",
    name: profile.name,
    contactPoints: profile.contactPoints.join(", "),
    port: String(profile.port),
    localDataCenter: profile.localDataCenter,
    keyspace: profile.keyspace ?? "",
    username: profile.username ?? "",
    password: "",
    useTls: profile.useTls,
    migrationsFolder: profile.migrationsFolder ?? "",
    migrationsKeyspace: profile.migrationsKeyspace ?? "",
    ssh: sshDraftFromProfile(profile.ssh)
  };
}

const inputClassName =
  "w-full rounded-ui border border-line bg-panel px-2.5 py-1.5 text-[13px] text-text placeholder:text-subtle focus-visible:border-accent focus-visible:outline-none";
const labelClassName = "grid gap-1 text-[11.5px] font-medium text-muted";

export function ConnectionForm({
  editing,
  onCancel,
  onSubmit
}: {
  editing?: ProfileListItem | undefined;
  onCancel?: () => void;
  onSubmit(input: ConnectionDraft): Promise<void>;
}) {
  const [draft, setDraft] = useState<ConnectionDraft>(editing ? draftFromProfile(editing) : cassandraDefault);
  const typeLocked = Boolean(editing);

  const switchType = (next: ProfileType) => {
    if (typeLocked || next === draft.type) return;
    setDraft(defaultForType(next));
  };

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    await onSubmit(draft);
    if (!editing) setDraft(defaultForType(draft.type));
    onCancel?.();
  }

  function placeholderForType(type: ProfileType): string {
    if (type === "redis") return "Cache - prod";
    if (type === "postgres") return "App db - prod";
    return "Production read";
  }

  return (
    <form className="flex min-h-0 flex-1 flex-col" onSubmit={(event) => void submit(event)}>
      <div className="grid gap-3 px-5 pb-3 pt-2">
        <div className="inline-flex items-center gap-0 rounded-ui border border-line p-0.5 self-start">
          <TypeOption icon={<Database size={13} strokeWidth={1.7} />} label="Cassandra" selected={draft.type === "cassandra"} onClick={() => switchType("cassandra")} disabled={typeLocked} />
          <TypeOption icon={<HardDrive size={13} strokeWidth={1.7} />} label="Postgres" selected={draft.type === "postgres"} onClick={() => switchType("postgres")} disabled={typeLocked} />
          <TypeOption icon={<Server size={13} strokeWidth={1.7} />} label="Redis" selected={draft.type === "redis"} onClick={() => switchType("redis")} disabled={typeLocked} />
        </div>

        <label className={labelClassName}>
          Name
          <input
            className={inputClassName}
            value={draft.name}
            onChange={(event) => setDraft({ ...draft, name: event.target.value })}
            required
            placeholder={placeholderForType(draft.type)}
          />
        </label>

        {draft.type === "cassandra" ? (
          <CassandraFields draft={draft} setDraft={setDraft} editing={Boolean(editing)} />
        ) : draft.type === "redis" ? (
          <RedisFields draft={draft} setDraft={setDraft} editing={Boolean(editing)} />
        ) : (
          <PostgresFields draft={draft} setDraft={setDraft} editing={Boolean(editing)} />
        )}
      </div>

      <div className="sticky bottom-0 mt-auto flex shrink-0 justify-end gap-1 border-t border-line-soft bg-panel px-5 py-3">
        {onCancel ? <Button type="button" onClick={onCancel}>Cancel</Button> : null}
        <Button variant="primary" type="submit">{editing ? "Save changes" : "Save connection"}</Button>
      </div>
    </form>
  );
}

function TypeOption({ icon, label, selected, onClick, disabled }: { icon: React.ReactNode; label: string; selected: boolean; onClick(): void; disabled: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`flex items-center gap-1.5 rounded-[4px] px-2.5 py-1 text-[12px] font-medium transition-colors disabled:opacity-50 ${
        selected ? "bg-line-soft text-text" : "text-muted hover:text-text"
      }`}
    >
      {icon}
      {label}
    </button>
  );
}

function CassandraFields({
  draft,
  setDraft,
  editing
}: {
  draft: CassandraConnectionDraft;
  setDraft(next: ConnectionDraft): void;
  editing: boolean;
}) {
  const update = <K extends keyof CassandraConnectionDraft>(key: K, value: CassandraConnectionDraft[K]) =>
    setDraft({ ...draft, [key]: value });

  return (
    <>
      <label className={labelClassName}>
        Contact points
        <input className={inputClassName} value={draft.contactPoints} onChange={(event) => update("contactPoints", event.target.value)} required placeholder="127.0.0.1, 10.0.0.5" />
      </label>
      <div className="grid grid-cols-[88px_1fr] gap-2">
        <label className={labelClassName}>
          Port
          <input className={inputClassName} value={draft.port ?? ""} onChange={(event) => update("port", event.target.value)} />
        </label>
        <label className={labelClassName}>
          Datacenter
          <input className={inputClassName} value={draft.localDataCenter ?? ""} onChange={(event) => update("localDataCenter", event.target.value)} />
        </label>
      </div>
      <label className={labelClassName}>
        Keyspace
        <input className={inputClassName} value={draft.keyspace ?? ""} onChange={(event) => update("keyspace", event.target.value)} />
      </label>
      <UserPasswordTls draft={draft} editing={editing} onChange={(updates) => setDraft({ ...draft, ...updates } as ConnectionDraft)} />
      <SshFields ssh={draft.ssh} editing={editing} onChange={(ssh) => update("ssh", ssh)} />

      <div className="mt-2 border-t border-line-soft pt-3">
        <h3 className="text-[11.5px] font-medium text-text">Migrations <span className="font-normal text-subtle">· optional</span></h3>
        <p className="mt-0.5 text-[11px] text-muted">Configure a folder and target keyspace to enable the Migrations page for this connection.</p>
        <div className="mt-2 grid gap-2">
          <label className={labelClassName}>
            Migrations folder
            <div className="flex items-center gap-1">
              <input className={inputClassName} value={draft.migrationsFolder ?? ""} onChange={(event) => update("migrationsFolder", event.target.value)} placeholder="/path/to/migrations" />
              {draft.migrationsFolder ? (
                <Button variant="icon" type="button" onClick={() => update("migrationsFolder", "")} tooltip="Clear">
                  <X size={12} strokeWidth={1.7} />
                </Button>
              ) : null}
              <Button type="button" onClick={async () => { const f = await window.cassandraDesk.pickMigrationsFolder(); if (f) update("migrationsFolder", f); }} tooltip="Browse">
                <FolderOpen size={13} strokeWidth={1.7} />
                <span>Browse</span>
              </Button>
            </div>
          </label>
          <label className={labelClassName}>
            Migrations keyspace
            <input className={inputClassName} value={draft.migrationsKeyspace ?? ""} onChange={(event) => update("migrationsKeyspace", event.target.value)} placeholder="e.g. app_schema" />
          </label>
        </div>
      </div>
    </>
  );
}

function RedisFields({
  draft,
  setDraft,
  editing
}: {
  draft: RedisConnectionDraft;
  setDraft(next: ConnectionDraft): void;
  editing: boolean;
}) {
  const update = <K extends keyof RedisConnectionDraft>(key: K, value: RedisConnectionDraft[K]) =>
    setDraft({ ...draft, [key]: value });

  return (
    <>
      <div className="grid grid-cols-[1fr_88px_72px] gap-2">
        <label className={labelClassName}>
          Host
          <input className={inputClassName} value={draft.host} onChange={(event) => update("host", event.target.value)} required placeholder="127.0.0.1" />
        </label>
        <label className={labelClassName}>
          Port
          <input className={inputClassName} value={draft.port ?? ""} onChange={(event) => update("port", event.target.value)} placeholder="6379" />
        </label>
        <label className={labelClassName}>
          DB
          <input className={inputClassName} value={draft.db ?? ""} onChange={(event) => update("db", event.target.value)} placeholder="0" />
        </label>
      </div>
      <UserPasswordTls draft={draft} editing={editing} onChange={(updates) => setDraft({ ...draft, ...updates } as ConnectionDraft)} />
      <SshFields ssh={draft.ssh} editing={editing} onChange={(ssh) => update("ssh", ssh)} />
    </>
  );
}

function PostgresFields({
  draft,
  setDraft,
  editing
}: {
  draft: PostgresConnectionDraft;
  setDraft(next: ConnectionDraft): void;
  editing: boolean;
}) {
  const update = <K extends keyof PostgresConnectionDraft>(key: K, value: PostgresConnectionDraft[K]) =>
    setDraft({ ...draft, [key]: value });

  return (
    <>
      <label className={labelClassName}>
        Connection string <span className="font-normal text-subtle">· optional, overrides fields below on save</span>
        <input
          className={inputClassName}
          value={draft.connectionString ?? ""}
          onChange={(event) => update("connectionString", event.target.value)}
          placeholder="postgres://user:pass@host:5432/db?sslmode=require"
        />
      </label>
      <div className="grid grid-cols-[1fr_88px] gap-2">
        <label className={labelClassName}>
          Host
          <input className={inputClassName} value={draft.host} onChange={(event) => update("host", event.target.value)} required placeholder="127.0.0.1" />
        </label>
        <label className={labelClassName}>
          Port
          <input className={inputClassName} value={draft.port ?? ""} onChange={(event) => update("port", event.target.value)} placeholder="5432" />
        </label>
      </div>
      <label className={labelClassName}>
        Database
        <input className={inputClassName} value={draft.database} onChange={(event) => update("database", event.target.value)} required placeholder="postgres" />
      </label>
      <UserPasswordTls draft={draft} editing={editing} onChange={(updates) => setDraft({ ...draft, ...updates } as ConnectionDraft)} />
      <label className={labelClassName}>
        SSL mode <span className="font-normal text-subtle">· strictness when TLS is on</span>
        <select
          className={inputClassName}
          value={draft.sslMode ?? ""}
          onChange={(event) => {
            const value = event.target.value;
            if (value === "require" || value === "verify-ca" || value === "verify-full") {
              update("sslMode", value);
            } else {
              const next: PostgresConnectionDraft = { ...draft };
              delete next.sslMode;
              setDraft(next);
            }
          }}
        >
          <option value="">Default (require when TLS on)</option>
          <option value="require">require</option>
          <option value="verify-ca">verify-ca</option>
          <option value="verify-full">verify-full</option>
        </select>
      </label>
      <SshFields ssh={draft.ssh} editing={editing} onChange={(ssh) => update("ssh", ssh)} />
    </>
  );
}

function SshFields({
  ssh,
  editing,
  onChange
}: {
  ssh: SshConnectionDraft | undefined;
  editing: boolean;
  onChange(next: SshConnectionDraft): void;
}) {
  const value = ssh ?? sshDraftDefault;
  const update = <K extends keyof SshConnectionDraft>(key: K, next: SshConnectionDraft[K]) =>
    onChange({ ...value, [key]: next });

  return (
    <div className="mt-2 border-t border-line-soft pt-3">
      <label className="flex items-center gap-2 text-[12px] text-muted">
        <input
          className="h-3.5 w-3.5 accent-accent"
          checked={value.enabled}
          onChange={(event) => update("enabled", event.target.checked)}
          type="checkbox"
        />
        <span className="text-[11.5px] font-medium text-text">
          SSH tunnel <span className="font-normal text-subtle">· optional, connect through a bastion</span>
        </span>
      </label>
      {value.enabled ? (
        <div className="mt-2 grid gap-2">
          <div className="grid grid-cols-[1fr_88px] gap-2">
            <label className={labelClassName}>
              SSH host
              <input className={inputClassName} value={value.host} onChange={(event) => update("host", event.target.value)} placeholder="bastion.example.com" />
            </label>
            <label className={labelClassName}>
              Port
              <input className={inputClassName} value={value.port ?? ""} onChange={(event) => update("port", event.target.value)} placeholder="22" />
            </label>
          </div>
          <label className={labelClassName}>
            SSH user
            <input className={inputClassName} value={value.username} onChange={(event) => update("username", event.target.value)} placeholder="deploy" />
          </label>
          <label className={labelClassName}>
            Auth method
            <select
              className={inputClassName}
              value={value.authKind}
              onChange={(event) => update("authKind", event.target.value === "key" ? "key" : "password")}
            >
              <option value="password">Password</option>
              <option value="key">Private key</option>
            </select>
          </label>
          {value.authKind === "key" ? (
            <>
              <label className={labelClassName}>
                Private key path
                <input className={inputClassName} value={value.privateKeyPath ?? ""} onChange={(event) => update("privateKeyPath", event.target.value)} placeholder="~/.ssh/id_ed25519" />
              </label>
              <label className={labelClassName}>
                Passphrase{editing ? <span className="text-subtle font-normal"> · keep</span> : null}
                <input className={inputClassName} value={value.passphrase ?? ""} onChange={(event) => update("passphrase", event.target.value)} type="password" />
              </label>
            </>
          ) : (
            <label className={labelClassName}>
              SSH password{editing ? <span className="text-subtle font-normal"> · keep</span> : null}
              <input className={inputClassName} value={value.password ?? ""} onChange={(event) => update("password", event.target.value)} type="password" />
            </label>
          )}
        </div>
      ) : null}
    </div>
  );
}

function UserPasswordTls({
  draft,
  editing,
  onChange
}: {
  draft: ConnectionDraft;
  editing: boolean;
  onChange(updates: Partial<ConnectionDraft>): void;
}) {
  return (
    <>
      <div className="grid grid-cols-2 gap-2">
        <label className={labelClassName}>
          Username
          <input className={inputClassName} value={draft.username ?? ""} onChange={(event) => onChange({ username: event.target.value })} />
        </label>
        <label className={labelClassName}>
          Password{editing ? <span className="text-subtle font-normal"> · keep</span> : null}
          <input className={inputClassName} value={draft.password ?? ""} onChange={(event) => onChange({ password: event.target.value })} type="password" />
        </label>
      </div>
      <label className="mt-1 flex items-center gap-2 text-[12px] text-muted">
        <input className="h-3.5 w-3.5 accent-accent" checked={draft.useTls} onChange={(event) => onChange({ useTls: event.target.checked })} type="checkbox" />
        Use TLS
      </label>
    </>
  );
}
