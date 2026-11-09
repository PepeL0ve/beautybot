// Local management runner, NEVER place under tgcloud/endpoints.
import { pathToFileURL } from 'node:url';
export async function scheduledTick({ token, adminId }, management) {
  if (!token || !/^[1-9]\d*$/.test(String(adminId)) || !Number.isSafeInteger(Number(adminId))) throw new Error('SCHEDULER_CONFIG');
  const cloud = await management.getFiles(token);
  const sources = cloud.canonical_modules;
  if (!Number.isSafeInteger(cloud.revision) || !sources?.['lib/svc/tick']) throw new Error('SCHEDULER_NOT_DEPLOYED');
  const name = 'endpoints/scheduled_tick_operator';
  if (Object.hasOwn(sources, name)) throw new Error('OPERATOR_MUST_NOT_BE_DEPLOYED');
  const current = await management.getFiles(token);
  if (current.revision !== cloud.revision || JSON.stringify(current.canonical_modules) !== JSON.stringify(sources)) throw new Error('DEPLOYMENT_CHANGED');
  const wrapper = `import {runTick,TICK_PROTOCOL} from '../lib/svc/tick.js';
export default async function(input){if(TICK_PROTOCOL!==1)throw new Error('TICK_PROTOCOL');return await runTick({actorId:input.actorId,source:'scheduled',revision:input.revision});}`;
  const response = await management.runFunction(token, name, { ...sources, [name]: wrapper }, { actorId: Number(adminId), revision: cloud.revision }, {});
  const result = response?.result;
  if (response?.error || !result || !(result.status === 'success' || (result.status === 'skipped' && result.reason === 'overlap'))) throw new Error('SCHEDULER_RUN_FAILED');
  return { revision: cloud.revision, status: result.status, runId: result.runId ?? null };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.env.TGCLOUD_DEBUG = '0';
  try {
    const management = await import('../node_modules/@tgcloud/cli/src/api/endpoints.js');
    console.log(JSON.stringify(await scheduledTick({ token: process.env.TGCLOUD_TOKEN, adminId: process.env.SCHEDULER_ADMIN_ID }, management)));
  } catch {
    // API errors may contain remote logs/customer data; never dump them in Actions.
    console.error('Scheduled tick failed; inspect private runtime journal.');
    process.exitCode = 1;
  }
}
