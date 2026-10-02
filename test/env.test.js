import test from 'node:test';
import assert from 'node:assert/strict';
import { loadServerConfig, publicConfigView } from '../src/config/env.js';
const base={NEXUS_GITHUB_OWNER:'otavio',NEXUS_GITHUB_REPO:'NEXUS-DATA',NEXUS_GITHUB_TOKEN:'secret',NEXUS_WORKSPACE_ID:'w1',NEXUS_OWNER_USER_ID:'u1'};
test('loadServerConfig requires GitHub server values',()=>{assert.throws(()=>loadServerConfig({}),/NEXUS_GITHUB_OWNER/);assert.throws(()=>loadServerConfig({...base,NEXUS_GITHUB_REPO:''}),/NEXUS_GITHUB_REPO/);assert.throws(()=>loadServerConfig({...base,NEXUS_GITHUB_TOKEN:''}),/NEXUS_GITHUB_TOKEN/);});
test('publicConfigView never exposes github token',()=>{const cfg=loadServerConfig(base);assert.deepEqual(publicConfigView(cfg),{workspaceId:'w1'});assert.equal(JSON.stringify(publicConfigView(cfg)).includes('secret'),false);assert.equal(JSON.stringify(cfg).includes('secret'),true);});
test('loadServerConfig requires an owner user id for persistent admin sessions',()=>{const env={...base};delete env.NEXUS_OWNER_USER_ID;assert.throws(()=>loadServerConfig(env),/NEXUS_OWNER_USER_ID/);});
