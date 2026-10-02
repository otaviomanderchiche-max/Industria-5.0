import test from 'node:test';
import assert from 'node:assert/strict';
import { loadServerConfig, publicConfigView } from '../src/config/env.js';
test('loadServerConfig rejects missing required Supabase server values',()=>assert.throws(()=>loadServerConfig({}),/SUPABASE_URL/));
test('publicConfigView never exposes server credential',()=>{const cfg=loadServerConfig({SUPABASE_URL:'https://abc.supabase.co',SUPABASE_SERVER_KEY:'secret',NEXUS_WORKSPACE_ID:'w1'});assert.deepEqual(publicConfigView(cfg),{supabaseUrl:'https://abc.supabase.co',workspaceId:'w1'});assert.equal(JSON.stringify(publicConfigView(cfg)).includes('secret'),false)});
