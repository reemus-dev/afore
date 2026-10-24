import {createHash} from "node:crypto";
import {createReadStream, existsSync} from "node:fs";
import {homedir} from "node:os";
import path from "node:path";
import {createInterface} from "node:readline";
import {
  getSessionInfo,
  listSessions,
  type SDKSessionInfo,
} from "@anthropic-ai/claude-agent-sdk";
import type {TranscriptEntry} from "./events.js";

export const HEX_ID_LENGTH = 14;
/** How much of a transcript's end to search for its `continued-in` entry */
const TAIL_BYTES = 65_536;

export type SessionRecord = {
  id: string;
  hexId: string;
  project: string;
  title: string;
  created: string | null;
  lastActivity: string;
  size: number | null;
  firstPrompt: string | null;
  /** Absolute path to the session's JSONL file */
  transcript: string | null;
  /**
   * Sessions this one continues from transcripts that hold its earlier history,
   * oldest first
   */
  continues: Array<{id: string; transcript: string}>;
};

export type ProjectRecord = {
  project: string;
  sessions: SessionRecord[];
  /** Sessions continued in a new transcript, which lists leave out */
  continued: SessionRecord[];
};

/**
 * All sessions, newest first, grouped into projects by recorded cwd. Sessions
 * without a recorded cwd cannot be attributed to a project.
 */
export async function discoverProjects(): Promise<ProjectRecord[]> {
  const [sdkInfos, transcripts] = await Promise.all([
    listSessions(),
    findTranscripts(),
  ]);
  const withCwd = (info: SDKSessionInfo) => fillCwd(info, transcripts);
  const infos = await Promise.all(sdkInfos.map(withCwd));
  const continuations = await findContinuations(transcripts);
  const listed = new Set(infos.map(({sessionId}) => sessionId));
  // The SDK lists only the session continuing them
  const continuedInfos = await Promise.all(
    [...new Set(continuations.values())]
      .filter((id) => !listed.has(id))
      .map((id) => getSessionInfo(id).then((info) => info && withCwd(info))),
  );

  const record = (info: SDKSessionInfo, project: string): SessionRecord => {
    const continues: SessionRecord["continues"] = [];
    for (
      let id = continuations.get(info.sessionId);
      id !== undefined && !continues.some((session) => session.id === id);
      id = continuations.get(id)
    ) {
      const transcript = transcripts.get(id);
      if (transcript === undefined) break;
      continues.unshift({id, transcript});
    }
    return sessionRecord(
      info,
      project,
      transcripts.get(info.sessionId) ?? null,
      continues,
    );
  };
  const byProject = new Map<string, ProjectRecord>();
  for (const info of infos) {
    if (!info.cwd) continue;
    const project = byProject.get(info.cwd) ?? {
      project: info.cwd,
      sessions: [],
      continued: [],
    };
    project.sessions.push(record(info, info.cwd));
    byProject.set(info.cwd, project);
  }
  for (const info of continuedInfos) {
    if (info?.cwd)
      byProject.get(info.cwd)?.continued.push(record(info, info.cwd));
  }

  return [...byProject.values()].map((project) => ({
    ...project,
    sessions: project.sessions.toSorted((left, right) =>
      right.lastActivity.localeCompare(left.lastActivity),
    ),
  }));
}

/** Every session of the projects, newest activity first */
export function sessionsOf(projects: ProjectRecord[]): SessionRecord[] {
  return projects
    .flatMap((project) => project.sessions)
    .toSorted((left, right) =>
      right.lastActivity.localeCompare(left.lastActivity),
    );
}

/** Session UUID → transcript path; the SDK's session info carries no path */
async function findTranscripts(): Promise<Map<string, string>> {
  // Claude Code and the SDK read the same override
  const projectsDir = path.join(
    process.env.CLAUDE_CONFIG_DIR ?? path.join(homedir(), ".claude"),
    "projects",
  );
  const transcripts = new Map<string, string>();
  if (!existsSync(projectsDir)) return transcripts;
  for await (const match of new Bun.Glob("*/*.jsonl").scan(projectsDir)) {
    transcripts.set(
      path.basename(match, ".jsonl"),
      path.join(projectsDir, match),
    );
  }
  return transcripts;
}

/**
 * The SDK reads cwd from a transcript's first 64 KB, which a large first
 * prompt, such as a pasted image, can fill. Read on to the first entry that
 * records it.
 */
async function fillCwd(
  info: SDKSessionInfo,
  transcripts: Map<string, string>,
): Promise<SDKSessionInfo> {
  const transcript = transcripts.get(info.sessionId);
  if (info.cwd || transcript === undefined) return info;
  const input = createReadStream(transcript);
  try {
    for await (const line of createInterface({input})) {
      if (!line.includes('"cwd":"')) continue;
      const {cwd} = JSON.parse(line) as TranscriptEntry;
      if (typeof cwd === "string") return {...info, cwd};
    }
  } finally {
    input.destroy();
  }
  return info;
}

/**
 * Continuing session UUID → UUID of the session it continues. Resuming a
 * compacted session can move it to a new transcript that repeats the
 * compaction. The old transcript then ends with a `continued-in` entry naming
 * the new session. Like the SDK, search only the tail, so a link is missed if
 * the old session ran on long after it.
 */
async function findContinuations(
  transcripts: Map<string, string>,
): Promise<Map<string, string>> {
  const continuations = new Map<string, string>();
  await Promise.all(
    [...transcripts].map(async ([id, transcript]) => {
      const file = Bun.file(transcript);
      const start = Math.max(0, file.size - TAIL_BYTES);
      const lines = (await file.slice(start).text()).split("\n");
      // A cut first line is not JSON
      const entry = lines
        .slice(start > 0 ? 1 : 0)
        .findLast((line) => line.includes('"type":"continued-in"'));
      if (entry === undefined) return;
      const {continuedInSessionId} = JSON.parse(entry) as TranscriptEntry;
      if (typeof continuedInSessionId === "string") {
        continuations.set(continuedInSessionId, id);
      }
    }),
  );
  return continuations;
}

function sessionRecord(
  info: SDKSessionInfo,
  project: string,
  transcript: string | null,
  continues: SessionRecord["continues"],
): SessionRecord {
  return {
    id: info.sessionId,
    hexId: createHash("sha256")
      .update(info.sessionId, "utf8")
      .digest("hex")
      .slice(0, HEX_ID_LENGTH),
    project,
    title: info.summary,
    created:
      info.createdAt === undefined
        ? null
        : new Date(info.createdAt).toISOString(),
    lastActivity: new Date(info.lastModified).toISOString(),
    size: info.fileSize ?? null,
    firstPrompt: info.firstPrompt ?? null,
    transcript,
    continues,
  };
}
