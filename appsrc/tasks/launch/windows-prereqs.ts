
import mklog, {Logger} from "../../util/log";
const log = mklog("windows-prereqs");

import * as tmp from "tmp";
import * as bluebird from "bluebird";
import {isEmpty, find, filter, reject, partition, map} from "underscore";

import spawn from "../../util/spawn";
import pathmaker from "../../util/pathmaker";
import net from "../../util/net";
import sf from "../../util/sf";
import reg from "../../util/reg";

import * as ospath from "path";
import urls from "../../constants/urls";

import * as actions from "../../actions";

import {IManifest, IManifestPrereq, IMarket, ICaveRecord, IStore} from "../../types";

interface IWindowsPrereqsOpts {
  store: IStore;
  manifest: IManifest;
  globalMarket: IMarket;
  caveId: string;
  logger: Logger;
}

interface IRedistExitCode {
  code: number;
  success?: boolean;
  message?: string;
}

interface IRedistInfo {
  /** Human-friendly name for redist, e.g. "Microsoft Visual C++ 2010 Redistributable" */
  fullName: string;

  /** The exact version provided */
  version: string;

  /** Architecture of the redist */
  arch: "i386" | "amd64";

  /** Executable to launch (in .7z archive) */
  command: string;

  /** Arguments to give to executable on launch - aim for quiet/unattended/no reboots */
  args: string[];

  /** Should the executable be run as admin? */
  elevate?: boolean;

  /** Registry keys we can check to see if installed */
  registryKeys?: string[];

  /** List of DLLs to check for, to make sure it's installed */
  dlls?: string[];

  /** Meaning of some exit codes */
  exitCodes?: IRedistExitCode[];
}

import {EventEmitter} from "events";
import extract from "../../util/extract";

export default async function handleWindowsPrereqs (opts: IWindowsPrereqsOpts) {
  const {globalMarket, caveId} = opts;
  const cave = globalMarket.getEntity<ICaveRecord>("caves", caveId);

  if (!cave.installedUE4Prereq) {
    await handleUE4Prereq(cave, opts);
  }

  await handleManifest(opts);
}

async function handleUE4Prereq (cave: ICaveRecord, opts: IWindowsPrereqsOpts) {
  const {globalMarket} = opts;

  try {
    const executables = cave.executables;
    const prereqRelativePath = find(executables, (x: string) => /UE4PrereqSetup(_x64)?.exe/i.test(x));
    if (!prereqRelativePath) {
      // no UE4 prereqs
      return;
    }

    const appPath = pathmaker.appPath(cave);
    const prereqFullPath = ospath.join(appPath, prereqRelativePath);

    log(opts, `launching UE4 prereq setup ${prereqFullPath}`);
    const code = await spawn({
      command: prereqFullPath,
      args: [
        "/quiet", // don't show any dialogs
        "/norestart", // don't ask for OS to reboot
      ],
      onToken: (tok) => log(opts, `[ue4-prereq out] ${tok}`),
      onErrToken: (tok) => log(opts, `[ue4-prereq err] ${tok}`),
    });

    if (code === 0) {
      log(opts, "successfully installed UE4 prereq");
      await globalMarket.saveEntity("caves", cave.id, {
        installedUE4Prereq: true,
      }, {wait: true});
    } else {
      log(opts, `couldn't install UE4 prereq (exit code ${code})`);
    }
  } catch (e) {
    log(opts, `error while launching UE4 prereq for ${cave.id}: ${e.stack || e}`);
  }
}

interface IPrereqTask {
  /** prereq info taken from manifest */
  prereq: IManifestPrereq;

  /** contents of info.json file */
  info: IRedistInfo;

  /** if true, no further action is required */
  alreadyInstalled: boolean;
}

async function handleManifest (opts: IWindowsPrereqsOpts) {
  const {manifest} = opts;
  if (!manifest) {
    // TODO: auto-detect etc.
    return;
  }

  if (isEmpty(manifest.prereqs)) {
    return;
  }

  let prereqs = pendingPrereqs(opts, manifest.prereqs);
  if (isEmpty(prereqs)) {
    // everything already done
    return;
  }

  log(opts, `Assessing prereqs ${prereqs.join(", ")}`);

  let tasks = await bluebird.map(prereqs, async function (prereq) {
    return await assessDep(opts, prereq);
  });

  const {globalMarket, caveId} = opts;

  const cave = globalMarket.getEntity<ICaveRecord>("caves", caveId);
  let {installedPrereqs = {}} = cave;

  let [alreadyInstalledTasks, remainingTasks] = partition(tasks, (task) => task.alreadyInstalled);
  if (!isEmpty(alreadyInstalledTasks)) {
    log(opts, `Already installed: ${tasks.map((task) => task.prereq.name).join(", ")}`);
    const alreadyInstalledPrereqs = {} as {
      [key: string]: boolean;
    };
    for (const task of alreadyInstalledTasks) {
      alreadyInstalledPrereqs[task.prereq.name] = true;
    }
    installedPrereqs = Object.assign({}, installedPrereqs, alreadyInstalledPrereqs);
    await globalMarket.saveEntity("caves", caveId, {installedPrereqs});
  }

  if (isEmpty(remainingTasks)) {
    return;
  }
  log(opts, `Remaining tasks: ${tasks.map((task) => task.prereq.name).join(", ")}`);

  const workDir = tmp.dirSync();

  try {
    tasks = filter(tasks, null);

    await bluebird.all(map(tasks, async (task) => {
      await fetchDep(opts, task, workDir.name);
    }));

    const installScript = makeInstallScript(tasks, workDir.name);

    for (const task of tasks) {
      await installDep(opts, task);
    }
  } finally {
    await sf.wipe(workDir.name);
  }
}

function makeInstallScript (tasks: IPrereqTask[], baseWorkDir: string): string {
  let lines = "";

  for (const task of tasks) {

  }

  return lines.concat("\r\n");
}

function pendingPrereqs (opts: IWindowsPrereqsOpts, prereqs: IManifestPrereq[]): IManifestPrereq[] {
  const cave = opts.globalMarket.getEntity<ICaveRecord>("caves", opts.caveId);
  const {installedPrereqs} = cave;

  if (installedPrereqs) {
    return prereqs;
  } else {
    return reject(prereqs, (prereq) => installedPrereqs[prereq.name]);
  }
}

/**
 * Assess the amount of work needed for a prereq
 * Does registry checks, DLL checks, with a bit of luck there's nothing to do
 */
async function assessDep (opts: IWindowsPrereqsOpts, prereq: IManifestPrereq): Promise<IPrereqTask> {
  const infoUrl = `${getBaseURL(prereq)}/info.json`;
  log(opts, `Retrieving ${infoUrl}`);
  // bust cloudflare cache
  const infoRes = await net.request("get", infoUrl, {t: Date.now()}, {format: "json"});
  if (infoRes.statusCode !== 200) {
    throw new Error(`Could not install prerequisite ${prereq.name}: server replied with HTTP ${infoRes.statusCode}`);
  }

  const info = infoRes.body as IRedistInfo;

  let hasRegistry = false;

  if (info.registryKeys) {
    for (const registryKey of info.registryKeys) {
      try {
        await reg.regQuery(registryKey, {quiet: true});
        hasRegistry = true;
        log(opts, `Found registry key ${registryKey}`);
        break;
      } catch (e) {
        log(opts, `Key not present: ${registryKey}`);
      }
    }
  }

  let hasValidLibraries = false;

  if (hasRegistry) {
    if (info.dlls) {
      const dllassert = `dllassert${info.arch === "amd64" ? "64" : "32"}` ;
      hasValidLibraries = true;
      for (const dll of info.dlls) {
        const code = await spawn({
          command: dllassert,
          args: [dll],
          logger: opts.logger,
        });
        if (code !== 0) {
          log(opts, `Could not assert dll ${dll}`);
          hasValidLibraries = false;
        }
      }
    } else {
      log(opts, `Traces of packages already found, no DLLs to test, assuming good!`);
      hasValidLibraries = true;
    }
  }

  return {
    prereq,
    info,
    alreadyInstalled: hasValidLibraries,
  };
}

/**
 * Get the base URL for a prerequisite, where its info.json
 * file is stored, along with the archive we might need to download.
 */
function getBaseURL(prereq: IManifestPrereq): string {
  return `${urls.redistsBase}/${prereq.name}`;
}

function getWorkDir(baseWorkDir: string, prereq: IManifestPrereq): string {
  return ospath.join(baseWorkDir, prereq.name);
}

async function fetchDep (opts: IWindowsPrereqsOpts, task: IPrereqTask, baseWorkDir: string) {
  const {prereq, info} = task;
 
  const workDir = getWorkDir(baseWorkDir, prereq);
  await sf.mkdir(workDir);

  try {
    opts.store.dispatch(actions.statusMessage({
      message: ["login.status.dependency_install", {
        name: info.fullName,
        version: info.version || "?",
      }],
    }));

    log(opts, `Downloading prereq ${info.fullName}`);
    const baseUrl = getBaseURL(prereq);
    const archiveUrl = `${baseUrl}/${prereq.name}.7z`;
    const archivePath = ospath.join(workDir, `${prereq.name}.7z`);

    await net.downloadToFile(opts, archiveUrl, archivePath);

    log(opts, `Verifiying integrity of ${info.fullName} archive`);
    const algo = "SHA256";
    const sums = await net.getChecksums(opts, `${baseUrl}`, algo);
    const sum = sums[`${prereq.name}.7z`];

    await net.ensureChecksum(opts, {
      algo,
      expected: sum.hash,
      file: archivePath,
    });

    log(opts, `Extracting ${info.fullName} archive`);
    await extract.extract({
      emitter: new EventEmitter(),
      archivePath,
      destPath: workDir,
    });

    let command = ospath.join(info.command);
    let args = info.args;
    if (info.elevate) {
      args = [command, ...args];
      command = "elevate.exe";
    }

    log(opts, `Launching ${info.command} with args ${info.args.join(" ")}`);
    const code = await spawn({
      command,
      args,
      onToken:    (tok) => { log(opts, `[${prereq.name} out] ${tok}`); },
      onErrToken: (tok) => { log(opts, `[${prereq.name} err] ${tok}`); },
      opts: {
        cwd: workDir.name,
      },
    });

    if (code === 0) {
      log(opts, `Installed ${info.fullName} successfully!`);
    } else {
      let success = false;
      let message = "Unknown error code";

      if (info.exitCodes) {
        for (const exitCode of info.exitCodes) {
          if (exitCode.code === code) {
            message = exitCode.message;
            if (exitCode.success) {
              success = true;
              log(opts, `${prereq.name} exited with ${code}: ${exitCode.message}. Success!`);
            }
            break;
          }
        }
      }

      if (!success) {
        throw new Error(`Installer for ${info.fullName} exited with code ${code}: ${message}`);
      }
    }

    await markSuccess();
  } finally {
    await sf.wipe(workDir.name);
  }
}

async function installDep (opts: IWindowsPrereqsOpts, task: IPrereqTask) {
  const {globalMarket, caveId} = opts;
  const {prereq, info} = task;

  const cave = globalMarket.getEntity<ICaveRecord>("caves", caveId);
  let {installedPrereqs} = cave;
  if (installedPrereqs && installedPrereqs[prereq.name]) {
    log(opts, `Already installed ${prereq.name}, skipping...`);
    return;
  }

  const workDir = tmp.dirSync();

  try {
    const markSuccess = async () => {
      if (!installedPrereqs) {
        installedPrereqs = {};
      }
      installedPrereqs = Object.assign({}, installedPrereqs, {
        [prereq.name]: true,
      });
      await globalMarket.saveEntity("caves", caveId, {installedPrereqs}, {wait: true});
    };

    opts.store.dispatch(actions.statusMessage({
      message: ["login.status.dependency_install", {
        name: info.fullName,
        version: info.version || "?",
      }],
    }));

    log(opts, `Downloading prereq ${info.fullName}`);

    const archiveUrl = `${baseUrl}/${prereq.name}.7z`;
    const archivePath = ospath.join(workDir.name, `${prereq.name}.7z`);

    await net.downloadToFile(opts, archiveUrl, archivePath);

    log(opts, `Verifiying integrity of ${info.fullName} archive`);
    const algo = "SHA256";
    const sums = await net.getChecksums(opts, `${baseUrl}`, algo);
    const sum = sums[`${prereq.name}.7z`];

    await net.ensureChecksum(opts, {
      algo,
      expected: sum.hash,
      file: archivePath,
    });

    log(opts, `Extracting ${info.fullName} archive`);
    await extract.extract({
      emitter: new EventEmitter(),
      archivePath,
      destPath: workDir.name,
    });

    let command = ospath.join(info.command);
    let args = info.args;
    if (info.elevate) {
      args = [command, ...args];
      command = "elevate.exe";
    }

    log(opts, `Launching ${info.command} with args ${info.args.join(" ")}`);
    const code = await spawn({
      command,
      args,
      onToken:    (tok) => { log(opts, `[${prereq.name} out] ${tok}`); },
      onErrToken: (tok) => { log(opts, `[${prereq.name} err] ${tok}`); },
      opts: {
        cwd: workDir.name,
      },
    });

    if (code === 0) {
      log(opts, `Installed ${info.fullName} successfully!`);
    } else {
      let success = false;
      let message = "Unknown error code";

      if (info.exitCodes) {
        for (const exitCode of info.exitCodes) {
          if (exitCode.code === code) {
            message = exitCode.message;
            if (exitCode.success) {
              success = true;
              log(opts, `${prereq.name} exited with ${code}: ${exitCode.message}. Success!`);
            }
            break;
          }
        }
      }

      if (!success) {
        throw new Error(`Installer for ${info.fullName} exited with code ${code}: ${message}`);
      }
    }

    await markSuccess();
  } finally {
    await sf.wipe(workDir.name);
  }
}
