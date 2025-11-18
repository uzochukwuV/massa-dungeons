/*
  Massa On‑Chain Prediction Battle + Betting
  Two contracts in one file for clarity:
   1) game.ts      - Game & battle logic (characters, battles, turns, wildcards)
   2) prediction.ts- Betting subsystem (single pools + multipools/parlays)

  Implementation pattern and APIs follow the Massa AssemblyScript SDK style in your AMM example.
  NOTE: This is a comprehensive reference implementation. Review & audit before mainnet use.
*/

//////////////////////
// common.ts (shared)
//////////////////////

import {
  Address,
  Context,
  Storage,
  generateEvent,
  callerHasWriteAccess,
  balance,
} from '@massalabs/massa-as-sdk';
import { Args, stringToBytes, bytesToString as bytesToStr } from '@massalabs/as-types';
import { IERC20 } from '../interfaces/IERC20';
import { u256, u128 } from 'as-bignum/assembly';

// Shared constants
export const ODDS_SCALE_U128: u128 = u128.fromU64(1_000_000); // fixed-point for odds (6 decimals)
export const BASIS_POINTS: u64 = 10000;
export const DEFAULT_HOUSE_EDGE_BPS: u16 = 500; // 5%

// Roles
export const ADMIN_ROLE = 'admin';
export const PAUSER_ROLE = 'pauser';
export const SETTLER_ROLE = 'settler';

// Storage keys
export const PAUSED_KEY = 'paused';
export const LOCKED_KEY = 'locked';
export const AUTH_SETTLER_PREFIX = 'auth_settler:';

// Game statistics keys
export const CHARACTER_COUNT_KEY = 'character_count';
export const BATTLE_COUNT_KEY = 'battle_count';
export const TOTAL_BATTLES_FINISHED_KEY = 'total_battles_finished';
export const SINGLE_POOL_COUNT_KEY = 'single_pool_count';
export const MULTIPOOL_COUNT_KEY = 'multipool_count';
export const TOTAL_BETS_PLACED_KEY = 'total_bets_placed';
export const TOTAL_BETS_CLAIMED_KEY = 'total_bets_claimed';

// ============================================================================
// STORAGE HELPER FUNCTIONS - Consistent Key Management
// ============================================================================

/**
 * Get a counter value from storage
 */
function getCounter(key: string): u64 {
  const keyBytes = stringToBytes(key);
  if (!Storage.has(keyBytes)) {
    return 0;
  }
  return u64(parseInt(bytesToStr(Storage.get<StaticArray<u8>>(keyBytes))));
}

/**
 * Set a counter value in storage
 */
function setCounter(key: string, value: u64): void {
  Storage.set<StaticArray<u8>>(
    stringToBytes(key),
    stringToBytes(value.toString())
  );
}

/**
 * Increment a counter by 1 and return new value
 */
function incrementCounter(key: string): u64 {
  const current = getCounter(key);
  const next = current + 1;
  setCounter(key, next);
  return next;
}

/**
 * Get a string value from storage
 */
function getString(key: string): string {
  const keyBytes = stringToBytes(key);
  if (!Storage.has(keyBytes)) {
    return '';
  }
  return bytesToStr(Storage.get<StaticArray<u8>>(keyBytes));
}

/**
 * Set a string value in storage
 */
function setString(key: string, value: string): void {
  Storage.set<StaticArray<u8>>(
    stringToBytes(key),
    stringToBytes(value)
  );
}

/**
 * Get a boolean value from storage
 */
function getBool(key: string): bool {
  return getString(key) === 'true';
}

/**
 * Set a boolean value in storage
 */
function setBool(key: string, value: bool): void {
  setString(key, value ? 'true' : 'false');
}

/**
 * Delete a key from storage
 */
function deleteKey(key: string): void {
  Storage.del(stringToBytes(key));
}

/**
 * Check if a key exists in storage
 */
function hasKey(key: string): bool {
  return Storage.has(stringToBytes(key));
}

/**
 * Get bytes from storage
 */
function getBytes(key: string): StaticArray<u8> {
  return Storage.get<StaticArray<u8>>(stringToBytes(key));
}

/**
 * Set bytes in storage
 */
function setBytes(key: string, value: StaticArray<u8>): void {
  Storage.set<StaticArray<u8>>(stringToBytes(key), value);
}

// Common helpers

export function onlyRole(role: string): void {
  const caller = Context.caller();
  const roleKey = role + ':' + caller.toString();
  assert(hasKey(roleKey), `Access denied: missing role ${role}`);
}

export function whenNotPaused(): void {
  assert(!getBool(PAUSED_KEY), 'Contract paused');
}

export function nonReentrant(): void {
  assert(!hasKey(LOCKED_KEY), 'Reentrancy guard');
  setBool(LOCKED_KEY, true);
}

export function endNonReentrant(): void {
  deleteKey(LOCKED_KEY);
}

export function storeBump(name: string, bump: u8): void { // placeholder (for parity with PDA concept)
  setCounter('bump:' + name, bump as u64);
}

//////////////////////////////
// game.ts - Game contract
//////////////////////////////

/**
 * Game Contract
 * - Character creation
 * - Scheduled Battles (start_ts)
 * - Turn execution + simple RNG placeholder (use onchain VRF in production)
 * - Wildcards with decision windows
 * - Finalize battle & produce result (for Prediction contract to settle)
 */

export class Character {
  owner: Address;
  characterClass: u8; // 0=Warrior,1=Assassin,2=Mage,3=Tank,4=Trickster
  name: string;
  level: u16;
  xp: u64;
  maxHp: u64;
  currentHp: u64;
  baseDamageMin: u16;
  baseDamageMax: u16;
  critChance: u16; // percent
  dodgeChance: u16; // percent
  defense: u16;
  totalWins: u32;
  totalLosses: u32;
  mmr: u64;
  createdAt: u64;

  constructor() {
    this.owner = new Address('0');
    this.characterClass = 0;
    this.name = '';
    this.level = 1;
    this.xp = 0;
    this.maxHp = 0;
    this.currentHp = 0;
    this.baseDamageMin = 0;
    this.baseDamageMax = 0;
    this.critChance = 0;
    this.dodgeChance = 0;
    this.defense = 0;
    this.totalWins = 0;
    this.totalLosses = 0;
    this.mmr = 1000;
    this.createdAt = 0;
  }

  serialize(): StaticArray<u8> {
    const a = new Args();
    a.add(this.owner.toString());
    a.add(this.characterClass);
    a.add(this.name);
    a.add(this.level as u32);
    a.add(this.xp);
    a.add(this.maxHp);
    a.add(this.currentHp);
    a.add(this.baseDamageMin as u32);
    a.add(this.baseDamageMax as u32);
    a.add(this.critChance as u32);
    a.add(this.dodgeChance as u32);
    a.add(this.defense as u32);
    a.add(this.totalWins);
    a.add(this.totalLosses);
    a.add(this.mmr);
    a.add(this.createdAt);
    return a.serialize();
  }

  static deserialize(data: StaticArray<u8>): Character {
    const a = new Args(data);
    const c = new Character();
    c.owner = new Address(a.nextString().unwrap());
    c.characterClass = a.nextU8().unwrap();
    c.name = a.nextString().unwrap();
    c.level = a.nextU32().unwrap() as u16;
    c.xp = a.nextU64().unwrap();
    c.maxHp = a.nextU64().unwrap();
    c.currentHp = a.nextU64().unwrap();
    c.baseDamageMin = a.nextU32().unwrap() as u16;
    c.baseDamageMax = a.nextU32().unwrap() as u16;
    c.critChance = a.nextU32().unwrap() as u16;
    c.dodgeChance = a.nextU32().unwrap() as u16;
    c.defense = a.nextU32().unwrap() as u16;
    c.totalWins = a.nextU32().unwrap();
    c.totalLosses = a.nextU32().unwrap();
    c.mmr = a.nextU64().unwrap();
    c.createdAt = a.nextU64().unwrap();
    return c;
  }
}

export class Battle {
  player1Char: Address;
  player2Char: Address;
  player1Owner: Address;
  player2Owner: Address;
  startTs: u64;
  createdAt: u64;
  turnNumber: u32;
  currentTurn: u8; // 1 or 2
  isFinished: bool;
  winner: u8; // 0 none, 1 player1, 2 player2
  player1Hp: u64;
  player2Hp: u64;
  // wildcard state
  wildcardActive: bool;
  wildcardType: u8; // enum-like
  wildcardDecisionDeadline: u64;
  wildcardPlayer1Decision: i8; // -1 none, 0 no, 1 yes
  wildcardPlayer2Decision: i8;

  constructor() {
    this.player1Char = new Address('0');
    this.player2Char = new Address('0');
    this.player1Owner = new Address('0');
    this.player2Owner = new Address('0');
    this.startTs = 0;
    this.createdAt = 0;
    this.turnNumber = 0;
    this.currentTurn = 1;
    this.isFinished = false;
    this.winner = 0;
    this.player1Hp = 0;
    this.player2Hp = 0;
    this.wildcardActive = false;
    this.wildcardType = 0;
    this.wildcardDecisionDeadline = 0;
    this.wildcardPlayer1Decision = -1;
    this.wildcardPlayer2Decision = -1;
  }

  serialize(): StaticArray<u8> {
    const a = new Args();
    a.add(this.player1Char.toString());
    a.add(this.player2Char.toString());
    a.add(this.player1Owner.toString());
    a.add(this.player2Owner.toString());
    a.add(this.startTs);
    a.add(this.createdAt);
    a.add(this.turnNumber);
    a.add(this.currentTurn);
    a.add(this.isFinished);
    a.add(this.winner);
    a.add(this.player1Hp);
    a.add(this.player2Hp);
    a.add(this.wildcardActive);
    a.add(this.wildcardType);
    a.add(this.wildcardDecisionDeadline);
    a.add(this.wildcardPlayer1Decision as i32);
    a.add(this.wildcardPlayer2Decision as i32);
    return a.serialize();
  }

  static deserialize(data: StaticArray<u8>): Battle {
    const a = new Args(data);
    const b = new Battle();
    b.player1Char = new Address(a.nextString().unwrap());
    b.player2Char = new Address(a.nextString().unwrap());
    b.player1Owner = new Address(a.nextString().unwrap());
    b.player2Owner = new Address(a.nextString().unwrap());
    b.startTs = a.nextU64().unwrap();
    b.createdAt = a.nextU64().unwrap();
    b.turnNumber = a.nextU32().unwrap();
    b.currentTurn = a.nextU8().unwrap();
    b.isFinished = a.nextBool().unwrap();
    b.winner = a.nextU8().unwrap();
    b.player1Hp = a.nextU64().unwrap();
    b.player2Hp = a.nextU64().unwrap();
    b.wildcardActive = a.nextBool().unwrap();
    b.wildcardType = a.nextU8().unwrap();
    b.wildcardDecisionDeadline = a.nextU64().unwrap();
    b.wildcardPlayer1Decision = a.nextI32().unwrap() as i8;
    b.wildcardPlayer2Decision = a.nextI32().unwrap() as i8;
    return b;
  }
}

// Storage prefixes
const CHARACTER_PREFIX = 'character:'; // character:<id> -> serialized Character
const BATTLE_PREFIX = 'battle:';       // battle:<id> -> serialized Battle
const GAME_AUTH_SETTLER = 'game:auth_settler:'; // set by admin: {settlerAddress:true}

// Helpers
function characterKey(id: string): string { return CHARACTER_PREFIX + id; }
function battleKey(id: string): string { return BATTLE_PREFIX + id; }

// Constructor for game contract
export function game_constructor(_: StaticArray<u8>): void {
  assert(callerHasWriteAccess(), 'Must be deployment');
  const deployer = Context.caller();
  setString(ADMIN_ROLE + ':' + deployer.toString(), '1');
  setBool('game_initialized', true);

  // Initialize counters
  setCounter(CHARACTER_COUNT_KEY, 0);
  setCounter(BATTLE_COUNT_KEY, 0);
  setCounter(TOTAL_BATTLES_FINISHED_KEY, 0);

  generateEvent('Game contract deployed');
}

// Create character
export function game_createCharacter(args: StaticArray<u8>): void {
  whenNotPaused();
  nonReentrant();
  const ar = new Args(args);
  const id = ar.nextString().unwrap(); // client-provided unique id (e.g., name+owner)
  const classU8 = ar.nextU8().unwrap();
  const name = ar.nextString().unwrap();

  assert(!hasKey(characterKey(id)), 'character exists');

  const char = new Character();
  const caller = Context.caller();
  char.owner = caller;
  char.characterClass = classU8;
  char.name = name;
  char.level = 1;
  char.xp = 0;
  const ts = Context.timestamp();
  char.createdAt = ts;
  // set base stats
  switch (classU8) {
    case 0: // warrior
      char.maxHp = 120;
      char.currentHp = 120;
      char.baseDamageMin = 8;
      char.baseDamageMax = 15;
      char.critChance = 15;
      char.dodgeChance = 0;
      break;
    case 1: // assassin
      char.maxHp = 90;
      char.currentHp = 90;
      char.baseDamageMin = 12;
      char.baseDamageMax = 20;
      char.critChance = 35;
      char.dodgeChance = 20;
      break;
    case 2: // mage
      char.maxHp = 80;
      char.currentHp = 80;
      char.baseDamageMin = 10;
      char.baseDamageMax = 18;
      char.critChance = 20;
      char.dodgeChance = 0;
      break;
    case 3: // tank
      char.maxHp = 150;
      char.currentHp = 150;
      char.baseDamageMin = 6;
      char.baseDamageMax = 12;
      char.critChance = 10;
      char.dodgeChance = 0;
      break;
    case 4: // trickster
      char.maxHp = 100;
      char.currentHp = 100;
      char.baseDamageMin = 9;
      char.baseDamageMax = 16;
      char.critChance = 25;
      char.dodgeChance = 15;
      break;
    default:
      assert(false, 'invalid class');
  }

  setBytes(characterKey(id), char.serialize());
  incrementCounter(CHARACTER_COUNT_KEY);
  endNonReentrant();
  generateEvent('CharacterCreated:' + id);
}

// get character view
export function game_readCharacter(args: StaticArray<u8>): StaticArray<u8> {
  const ar = new Args(args);
  const id = ar.nextString().unwrap();
  if (!hasKey(characterKey(id))) return stringToBytes('null');
  return getBytes(characterKey(id));
}

// create battle (scheduled)
export function game_createBattle(args: StaticArray<u8>): void {
  whenNotPaused();
  nonReentrant();
  const ar = new Args(args);
  const battleId = ar.nextString().unwrap();
  const char1Id = ar.nextString().unwrap();
  const char2Id = ar.nextString().unwrap();
  const startTs = ar.nextU64().unwrap(); // unix ms

  assert(!hasKey(battleKey(battleId)), 'battle exists');

  // load characters
  assert(hasKey(characterKey(char1Id)) && hasKey(characterKey(char2Id)), 'characters missing');
  const c1Data = getBytes(characterKey(char1Id));
  const c2Data = getBytes(characterKey(char2Id));
  const c1 = Character.deserialize(c1Data);
  const c2 = Character.deserialize(c2Data);

  // require callers be owners (player1 creates)
  const caller = Context.caller();
  assert(caller.toString() == c1.owner.toString(), 'not owner of char1');

  const battle = new Battle();
  battle.player1Char = new Address(c1Data ? c1Data.length > 0 ? c1.owner.toString() : '' : '0'); // placeholder, store addresses
  battle.player1Char = new Address(char1Id); // for identity we store char id as pseudo address string
  battle.player2Char = new Address(char2Id);
  battle.player1Owner = c1.owner;
  battle.player2Owner = c2.owner;
  battle.startTs = startTs;
  battle.createdAt = Context.timestamp();
  battle.turnNumber = 0;
  battle.currentTurn = 1;
  battle.isFinished = false;
  battle.winner = 0;
  battle.player1Hp = c1.maxHp;
  battle.player2Hp = c2.maxHp;
  battle.wildcardActive = false;
  battle.wildcardType = 0;
  battle.wildcardDecisionDeadline = 0;
  battle.wildcardPlayer1Decision = -1;
  battle.wildcardPlayer2Decision = -1;

  setBytes(battleKey(battleId), battle.serialize());
  incrementCounter(BATTLE_COUNT_KEY);
  endNonReentrant();
  generateEvent('BattleCreated:' + battleId);
}

// Internal helper: simple (insecure) RNG - for prototype only
function simple_random(seed: u64, salt: u64): u64 {
  const x = seed ^ salt ^ Context.timestamp() as u64;
  // xorshift-ish
  let r = x;
  r ^= r << 13;
  r ^= r >> 7;
  r ^= r << 17;
  return r & 0xffffffffffffffff;
}

// execute turn
export function game_executeTurn(args: StaticArray<u8>): void {
  whenNotPaused();
  nonReentrant();
  const ar = new Args(args);
  const battleId = ar.nextString().unwrap();
  const attackerCharId = ar.nextString().unwrap();
  const stance = ar.nextU8().unwrap(); // 0..4
  const useSpecial = ar.nextBool().unwrap();

  assert(hasKey(battleKey(battleId)), 'battle missing');
  const bData = getBytes(battleKey(battleId));
  const battle = Battle.deserialize(bData);

  assert(!battle.isFinished, 'battle finished');

  // verify attacker owner
  const attackerChar = attackerCharId;
  let isPlayer1 = false;
  if (attackerChar == battle.player1Char.toString()) isPlayer1 = true;
  const caller = Context.caller();
  const expectedOwner = isPlayer1 ? battle.player1Owner : battle.player2Owner;
  assert(caller.toString() == expectedOwner.toString(), 'not turn owner');

  // ensure it's the right turn
  assert((isPlayer1 && battle.currentTurn == 1) || (!isPlayer1 && battle.currentTurn == 2), 'not your turn');

  // apply DOTs not implemented in this simplified snippet; you can add similar to AMM example

  // wildcard check (prototype uses simple_random, insecure)
  const wildcardChance: u64 = (isPlayer1 && attackerCharId == 'Trickster') ? 25 : 10; // simple heuristic
  const roll = simple_random(battle.turnNumber as u64 + battle.createdAt, 1) % 100;
  if (roll < wildcardChance && !battle.wildcardActive) {
    // set wildcard
    battle.wildcardActive = true;
    battle.wildcardType = (simple_random(battle.turnNumber as u64, 2) % 4) as u8; // limited set
    battle.wildcardDecisionDeadline = Context.timestamp() + 10000; // 10s proto
    battle.wildcardPlayer1Decision = -1;
    battle.wildcardPlayer2Decision = -1;
    setBytes(battleKey(battleId), battle.serialize());
    endNonReentrant();
    generateEvent('WildcardTriggered:' + battleId);
    return;
  }

  // compute damage (simplified)
  // load characters to get stats
  const c1Raw = getBytes(characterKey(battle.player1Char.toString()));
  const c2Raw = getBytes(characterKey(battle.player2Char.toString()));
  const c1 = Character.deserialize(c1Raw);
  const c2 = Character.deserialize(c2Raw);

  const attacker = isPlayer1 ? c1 : c2;
  const defender = isPlayer1 ? c2 : c1;

  // damage base
  const dmgRange = attacker.baseDamageMax - attacker.baseDamageMin;
  let rollDamage = (simple_random(battle.turnNumber as u64 + Context.timestamp(), 3) % (dmgRange as u64 + 1)) as u16;
  let baseDamage = attacker.baseDamageMin + rollDamage;
  // level bonus
  baseDamage = baseDamage + (attacker.level - 1) * 2;

  // crit check
  const critRoll = (simple_random(battle.turnNumber as u64 + Context.timestamp(), 4) % 100) as u16;
  let damage = baseDamage as u64;
  if (critRoll < attacker.critChance) {
    damage = damage * 2;
  }

  // apply defense and dodge
  if ((simple_random(battle.turnNumber as u64 + Context.timestamp(), 6) % 100) < defender.dodgeChance) {
    damage = 0;
  } else {
    damage = damage > defender.defense as u64 ? damage - defender.defense as u64 : 0;
  }

  if (isPlayer1) {
    battle.player2Hp = battle.player2Hp > damage ? battle.player2Hp - damage : 0;
  } else {
    battle.player1Hp = battle.player1Hp > damage ? battle.player1Hp - damage : 0;
  }

  battle.turnNumber += 1;
  battle.currentTurn = battle.currentTurn == 1 ? 2 : 1;

  // check finish
  if (battle.player1Hp == 0 || battle.player2Hp == 0) {
    battle.isFinished = true;
    battle.winner = battle.player1Hp > 0 ? 1 : 2;
    generateEvent('BattleEnded:' + battleId);
  }

  setBytes(battleKey(battleId), battle.serialize());
  endNonReentrant();
  generateEvent('TurnExecuted:' + battleId);
}

// decide wildcard
export function game_decideWildcard(args: StaticArray<u8>): void {
  whenNotPaused();
  nonReentrant();
  const ar = new Args(args);
  const battleId = ar.nextString().unwrap();
  const accept = ar.nextBool().unwrap();
  const playerCharId = ar.nextString().unwrap();

  assert(hasKey(battleKey(battleId)), 'battle missing');
  const bData = getBytes(battleKey(battleId));
  const battle = Battle.deserialize(bData);

  assert(battle.wildcardActive, 'no wildcard active');
  assert(Context.timestamp() <= battle.wildcardDecisionDeadline, 'decision window expired');

  const isPlayer1 = playerCharId == battle.player1Char.toString();
  const caller = Context.caller();
  const expectedOwner = isPlayer1 ? battle.player1Owner : battle.player2Owner;
  assert(caller.toString() == expectedOwner.toString(), 'not owner');

  if (isPlayer1) {
    battle.wildcardPlayer1Decision = accept ? 1 : 0;
  } else {
    battle.wildcardPlayer2Decision = accept ? 1 : 0;
  }

  // if both decided resolve
  if (battle.wildcardPlayer1Decision != -1 && battle.wildcardPlayer2Decision != -1) {
    // simplistic resolution (demo)
    const p1 = battle.wildcardPlayer1Decision == 1;
    const p2 = battle.wildcardPlayer2Decision == 1;
    if (p1 && p2) {
      // apply some benefit
      if (battle.wildcardType == 0) {
        // double damage next turn: represent as combo increment
        // (for brevity, apply immediate effect)
        const newHp1 = battle.player1Hp + 50;
        battle.player1Hp = newHp1 < 1_000_000 ? newHp1 : 1_000_000;
        const newHp2 = battle.player2Hp + 50;
        battle.player2Hp = newHp2 < 1_000_000 ? newHp2 : 1_000_000;
      }
    }
    // reset wildcard
    battle.wildcardActive = false;
    battle.wildcardPlayer1Decision = -1;
    battle.wildcardPlayer2Decision = -1;
  }

  setBytes(battleKey(battleId), battle.serialize());
  endNonReentrant();
  generateEvent('WildcardDecision:' + battleId);
}

// finalize battle and optionally notify Prediction contract
export function game_finalizeBattle(args: StaticArray<u8>): void {
  whenNotPaused();
  nonReentrant();
  const ar = new Args(args);
  const battleId = ar.nextString().unwrap();

  assert(hasKey(battleKey(battleId)), 'battle missing');
  const bData = getBytes(battleKey(battleId));
  const battle = Battle.deserialize(bData);

  assert(battle.isFinished, 'not finished');
  assert(battle.winner != 0, 'no winner');

  // update characters' stats (load & modify)
  const c1Raw = getBytes(characterKey(battle.player1Char.toString()));
  const c2Raw = getBytes(characterKey(battle.player2Char.toString()));
  const c1 = Character.deserialize(c1Raw);
  const c2 = Character.deserialize(c2Raw);

  if (battle.winner == 1) {
    c1.totalWins += 1;
    c2.totalLosses += 1;
  } else {
    c2.totalWins += 1;
    c1.totalLosses += 1;
  }

  c1.currentHp = c1.maxHp;
  c2.currentHp = c2.maxHp;

  setBytes(characterKey(battle.player1Char.toString()), c1.serialize());
  setBytes(characterKey(battle.player2Char.toString()), c2.serialize());

  // Increment finished battles counter
  incrementCounter(TOTAL_BATTLES_FINISHED_KEY);

  // Emit an event with winner info: Prediction contract can listen to this event or be authorized to call settle
  generateEvent('BattleFinalized:' + battleId + ':winner=' + battle.winner.toString());

  endNonReentrant();
}

// admin functions
export function game_setPaused(args: StaticArray<u8>): void {
  onlyRole(PAUSER_ROLE);
  const ar = new Args(args);
  const paused = ar.nextBool().unwrap();
  setBool(PAUSED_KEY, paused);
  generateEvent('Game pause toggled');
}

export function game_grantSettler(args: StaticArray<u8>): void {
  onlyRole(ADMIN_ROLE);
  const ar = new Args(args);
  const addr = ar.nextString().unwrap();
  setString(AUTH_SETTLER_PREFIX + addr, '1');
  generateEvent('Game settler granted:' + addr);
}

// View function: get statistics
export function game_getStats(_: StaticArray<u8>): StaticArray<u8> {
  const result = new Args();
  result.add(getCounter(CHARACTER_COUNT_KEY));
  result.add(getCounter(BATTLE_COUNT_KEY));
  result.add(getCounter(TOTAL_BATTLES_FINISHED_KEY));
  return result.serialize();
}

// Enhanced Features: Character Upgrades
export function game_upgradeCharacter(args: StaticArray<u8>): void {
  whenNotPaused();
  nonReentrant();
  const ar = new Args(args);
  const charId = ar.nextString().unwrap();
  const upgradeType = ar.nextU8().unwrap(); // 0=HP, 1=Damage, 2=Crit, 3=Dodge

  assert(hasKey(characterKey(charId)), 'character not found');
  const charData = getBytes(characterKey(charId));
  const char = Character.deserialize(charData);

  const caller = Context.caller();
  assert(caller.toString() == char.owner.toString(), 'not owner');

  // XP requirement for upgrade (example: 100 XP per upgrade)
  const xpCost: u64 = 100;
  assert(char.xp >= xpCost, 'insufficient XP');

  char.xp -= xpCost;

  // Apply upgrade based on type
  switch (upgradeType) {
    case 0: // HP upgrade
      char.maxHp += 10;
      char.currentHp = char.maxHp;
      break;
    case 1: // Damage upgrade
      char.baseDamageMin += 2;
      char.baseDamageMax += 3;
      break;
    case 2: // Crit upgrade
      if (char.critChance < 50) char.critChance += 5;
      break;
    case 3: // Dodge upgrade
      if (char.dodgeChance < 40) char.dodgeChance += 5;
      break;
    default:
      assert(false, 'invalid upgrade type');
  }

  setBytes(characterKey(charId), char.serialize());
  endNonReentrant();
  generateEvent('CharacterUpgraded:' + charId + ':type=' + upgradeType.toString());
}

// Grant XP to character (called internally or by admin)
export function game_grantXP(args: StaticArray<u8>): void {
  onlyRole(ADMIN_ROLE); // In production, this could be called automatically after battles
  const ar = new Args(args);
  const charId = ar.nextString().unwrap();
  const xpAmount = ar.nextU64().unwrap();

  assert(hasKey(characterKey(charId)), 'character not found');
  const charData = getBytes(characterKey(charId));
  const char = Character.deserialize(charData);

  char.xp += xpAmount;

  // Level up logic
  const xpForNextLevel = (char.level as u64) * 200; // Example: level * 200 XP needed
  if (char.xp >= xpForNextLevel) {
    char.level += 1;
    char.xp -= xpForNextLevel;
    // Grant bonus stats on level up
    char.maxHp += 5;
    char.currentHp = char.maxHp;
    char.baseDamageMin += 1;
    char.baseDamageMax += 2;
    generateEvent('CharacterLevelUp:' + charId + ':level=' + char.level.toString());
  }

  setBytes(characterKey(charId), char.serialize());
  generateEvent('XPGranted:' + charId + ':amount=' + xpAmount.toString());
}

// Heal character (costs some resource or cooldown)
export function game_healCharacter(args: StaticArray<u8>): void {
  whenNotPaused();
  nonReentrant();
  const ar = new Args(args);
  const charId = ar.nextString().unwrap();

  assert(hasKey(characterKey(charId)), 'character not found');
  const charData = getBytes(characterKey(charId));
  const char = Character.deserialize(charData);

  const caller = Context.caller();
  assert(caller.toString() == char.owner.toString(), 'not owner');

  // Restore HP to max
  char.currentHp = char.maxHp;

  setBytes(characterKey(charId), char.serialize());
  endNonReentrant();
  generateEvent('CharacterHealed:' + charId);
}

// Get character leaderboard (top N characters by MMR)
export function game_getLeaderboard(args: StaticArray<u8>): StaticArray<u8> {
  // Note: This is a simplified version. In production, maintain a sorted index
  const ar = new Args(args);
  const topN = ar.nextU32().unwrap();

  // Return empty for now - implement with indexing service or iterator
  const result = new Args();
  result.add('Leaderboard: implement with indexer');
  return result.serialize();
}

//////////////////////////////
// prediction.ts - Betting contract
//////////////////////////////

/**
 * Prediction Contract
 * - SinglePool parimutuel pools (ERC20 staking)
 * - Multipool/parlay (betslip) system with batched accumulation
 * - setAuthorizedSettler to allow Game contract to call settle
 * - Uses ERC20 tokens for stakes (safeTransferFrom / safeTransfer)
 */

// Storage prefixes and keys
const SINGLE_POOL_PREFIX = 'spool:'; // single pool id -> serialized SinglePool
const SINGLE_BET_PREFIX = 'sbet:';   // sbet:<poolId>:<bettor> -> Bet
const MULTIPOOL_PREFIX = 'mpool:';   // multipool id -> Multipool
const BETSLIP_PREFIX = 'betslip:';   // betslip id -> Betslip
const AUTH_SETTLER_KEY = 'auth:settler'; // map key prefix handled via setAuthorizedSettler

// Structures
export class SinglePool {
  poolId: string; // unique id string
  battleId: string; // associated battle
  token: Address; // ERC20 token address used for stakes
  closeTs: u64;
  totalPool: u128; // use u128 for totals internally
  outcomeABets: u128;
  outcomeBBets: u128;
  outcomeAOddsFP: u128;
  outcomeBOddsFP: u128;
  houseEdgeBps: u16;
  isClosed: bool;
  isSettled: bool;
  winningOutcome: i8; // -1 none, 0 A, 1 B
  createdAt: u64;

  constructor() {
    this.poolId = '';
    this.battleId = '';
    this.token = new Address('0');
    this.closeTs = 0;
    this.totalPool = u128.Zero;
    this.outcomeABets = u128.Zero;
    this.outcomeBBets = u128.Zero;
    this.outcomeAOddsFP = u128.Zero;
    this.outcomeBOddsFP = u128.Zero;
    this.houseEdgeBps = DEFAULT_HOUSE_EDGE_BPS;
    this.isClosed = false;
    this.isSettled = false;
    this.winningOutcome = -1;
    this.createdAt = 0;
  }

  serialize(): StaticArray<u8> {
    const a = new Args();
    a.add(this.poolId);
    a.add(this.battleId);
    a.add(this.token.toString());
    a.add(this.closeTs);
    a.add(this.totalPool.toString());
    a.add(this.outcomeABets.toString());
    a.add(this.outcomeBBets.toString());
    a.add(this.outcomeAOddsFP.toString());
    a.add(this.outcomeBOddsFP.toString());
    a.add(this.houseEdgeBps as u32);
    a.add(this.isClosed);
    a.add(this.isSettled);
    a.add(this.winningOutcome as i32);
    a.add(this.createdAt);
    return a.serialize();
  }

  static deserialize(data: StaticArray<u8>): SinglePool {
    const a = new Args(data);
    const p = new SinglePool();
    p.poolId = a.nextString().unwrap();
    p.battleId = a.nextString().unwrap();
    p.token = new Address(a.nextString().unwrap());
    p.closeTs = a.nextU64().unwrap();
    p.totalPool = u128.fromString(a.nextString().unwrap());
    p.outcomeABets = u128.fromString(a.nextString().unwrap());
    p.outcomeBBets = u128.fromString(a.nextString().unwrap());
    p.outcomeAOddsFP = u128.fromString(a.nextString().unwrap());
    p.outcomeBOddsFP = u128.fromString(a.nextString().unwrap());
    p.houseEdgeBps = a.nextU32().unwrap() as u16;
    p.isClosed = a.nextBool().unwrap();
    p.isSettled = a.nextBool().unwrap();
    p.winningOutcome = a.nextI32().unwrap() as i8;
    p.createdAt = a.nextU64().unwrap();
    return p;
  }
}

export class SingleBet {
  bettor: Address;
  poolId: string;
  amount: u128;
  outcome: i8; // 0 A, 1 B
  isClaimed: bool;
  placedAt: u64;

  constructor() {
    this.bettor = new Address('0');
    this.poolId = '';
    this.amount = u128.Zero;
    this.outcome = -1;
    this.isClaimed = false;
    this.placedAt = 0;
  }

  serialize(): StaticArray<u8> {
    const a = new Args();
    a.add(this.bettor.toString());
    a.add(this.poolId);
    a.add(this.amount.toString());
    a.add(this.outcome as i32);
    a.add(this.isClaimed);
    a.add(this.placedAt);
    return a.serialize();
  }

  static deserialize(data: StaticArray<u8>): SingleBet {
    const a = new Args(data);
    const b = new SingleBet();
    b.bettor = new Address(a.nextString().unwrap());
    b.poolId = a.nextString().unwrap();
    b.amount = u128.fromString(a.nextString().unwrap());
    b.outcome = a.nextI32().unwrap() as i8;
    b.isClaimed = a.nextBool().unwrap();
    b.placedAt = a.nextU64().unwrap();
    return b;
  }
}

// Multipool & Betslip simplified (weights in u128 fixed point)
export class Multipool {
  multipoolId: string;
  token: Address;
  totalPool: u128;
  totalWeightFP: u128; // sum of weight_fp of all tickets
  totalWinnerWeightFP: u128;
  isFinalized: bool;
  houseEdgeBps: u16;
  createdAt: u64;

  constructor() {
    this.multipoolId = '';
    this.token = new Address('0');
    this.totalPool = u128.Zero;
    this.totalWeightFP = u128.Zero;
    this.totalWinnerWeightFP = u128.Zero;
    this.isFinalized = false;
    this.houseEdgeBps = DEFAULT_HOUSE_EDGE_BPS;
    this.createdAt = 0;
  }

  serialize(): StaticArray<u8> {
    const a = new Args();
    a.add(this.multipoolId);
    a.add(this.token.toString());
    a.add(this.totalPool.toString());
    a.add(this.totalWeightFP.toString());
    a.add(this.totalWinnerWeightFP.toString());
    a.add(this.isFinalized);
    a.add(this.houseEdgeBps as u32);
    a.add(this.createdAt);
    return a.serialize();
  }

  static deserialize(data: StaticArray<u8>): Multipool {
    const a = new Args(data);
    const m = new Multipool();
    m.multipoolId = a.nextString().unwrap();
    m.token = new Address(a.nextString().unwrap());
    m.totalPool = u128.fromString(a.nextString().unwrap());
    m.totalWeightFP = u128.fromString(a.nextString().unwrap());
    m.totalWinnerWeightFP = u128.fromString(a.nextString().unwrap());
    m.isFinalized = a.nextBool().unwrap();
    m.houseEdgeBps = a.nextU32().unwrap() as u16;
    m.createdAt = a.nextU64().unwrap();
    return m;
  }
}

export class BetslipSelection {
  poolId: string;
  outcome: i8;
  oddsFP: u128;
  constructor() {
    this.poolId = '';
    this.outcome = -1;
    this.oddsFP = u128.Zero;
  }
  // for simplicity, use JSON-like serialization inside Args (string)
  toString(): string {
    return `${this.poolId}|${this.outcome.toString()}|${this.oddsFP.toString()}`;
  }
  static fromString(s: string): BetslipSelection {
    const parts = s.split('|');
    const sel = new BetslipSelection();
    sel.poolId = parts[0];
    sel.outcome = parseInt(parts[1]) as i8;
    sel.oddsFP = u128.fromString(parts[2]);
    return sel;
  }
}

export class Betslip {
  betslipId: string;
  bettor: Address;
  multipoolId: string;
  amount: u128;
  selections: string[]; // array of selection strings
  combinedOddsFP: u128;
  weightFP: u128;
  isWinner: bool;
  isClaimed: bool;
  isAccounted: bool;
  placedAt: u64;

  constructor() {
    this.betslipId = '';
    this.bettor = new Address('0');
    this.multipoolId = '';
    this.amount = u128.Zero;
    this.selections = [];
    this.combinedOddsFP = u128.Zero;
    this.weightFP = u128.Zero;
    this.isWinner = false;
    this.isClaimed = false;
    this.isAccounted = false;
    this.placedAt = 0;
  }

  serialize(): StaticArray<u8> {
    const a = new Args();
    a.add(this.betslipId);
    a.add(this.bettor.toString());
    a.add(this.multipoolId);
    a.add(this.amount.toString());
    a.add(this.selections.join('||'));
    a.add(this.combinedOddsFP.toString());
    a.add(this.weightFP.toString());
    a.add(this.isWinner);
    a.add(this.isClaimed);
    a.add(this.isAccounted);
    a.add(this.placedAt);
    return a.serialize();
  }

  static deserialize(data: StaticArray<u8>): Betslip {
    const a = new Args(data);
    const b = new Betslip();
    b.betslipId = a.nextString().unwrap();
    b.bettor = new Address(a.nextString().unwrap());
    b.multipoolId = a.nextString().unwrap();
    b.amount = u128.fromString(a.nextString().unwrap());
    const selStr = a.nextString().unwrap();
    b.selections = selStr.length > 0 ? selStr.split('||') : [];
    b.combinedOddsFP = u128.fromString(a.nextString().unwrap());
    b.weightFP = u128.fromString(a.nextString().unwrap());
    b.isWinner = a.nextBool().unwrap();
    b.isClaimed = a.nextBool().unwrap();
    b.isAccounted = a.nextBool().unwrap();
    b.placedAt = a.nextU64().unwrap();
    return b;
  }
}

// Helpers to read/write storage keys
function spoolKey(id: string): string { return SINGLE_POOL_PREFIX + id; }
function sbetKey(poolId: string, bettor: string): string { return SINGLE_BET_PREFIX + poolId + ':' + bettor; }
function mpoolKey(id: string): string { return MULTIPOOL_PREFIX + id; }
function betslipKey(id: string): string { return BETSLIP_PREFIX + id; }

// Constructor
export function prediction_constructor(_: StaticArray<u8>): void {
  assert(callerHasWriteAccess(), 'must be deployer');
  const deployer = Context.caller();
  setString(ADMIN_ROLE + ':' + deployer.toString(), '1');
  setBool('prediction_initialized', true);

  // Initialize counters
  setCounter(SINGLE_POOL_COUNT_KEY, 0);
  setCounter(MULTIPOOL_COUNT_KEY, 0);
  setCounter(TOTAL_BETS_PLACED_KEY, 0);
  setCounter(TOTAL_BETS_CLAIMED_KEY, 0);

  generateEvent('Prediction contract deployed');
}

// Create single pool
// args: poolId, battleId, tokenAddress (ERC20), closeTs (u64)
export function prediction_createSinglePool(args: StaticArray<u8>): void {
  whenNotPaused();
  nonReentrant();
  const ar = new Args(args);
  const poolId = ar.nextString().unwrap();
  const battleId = ar.nextString().unwrap();
  const tokenAddr = new Address(ar.nextString().unwrap());
  const closeTs = ar.nextU64().unwrap();

  assert(!hasKey(spoolKey(poolId)), 'pool exists');
  // Optionally enforce closeTs <= battle.startTs via cross-contract call to game. For now assume creator supplies consistent time.

  const p = new SinglePool();
  p.poolId = poolId;
  p.battleId = battleId;
  p.token = tokenAddr;
  p.closeTs = closeTs;
  p.totalPool = u128.Zero;
  p.outcomeABets = u128.Zero;
  p.outcomeBBets = u128.Zero;
  p.outcomeAOddsFP = u128.Zero;
  p.outcomeBOddsFP = u128.Zero;
  p.houseEdgeBps = DEFAULT_HOUSE_EDGE_BPS;
  p.isClosed = false;
  p.isSettled = false;
  p.winningOutcome = -1;
  p.createdAt = Context.timestamp();

  setBytes(spoolKey(poolId), p.serialize());
  incrementCounter(SINGLE_POOL_COUNT_KEY);
  endNonReentrant();
  generateEvent('SinglePoolCreated:' + poolId);
}

// Place single bet (ERC20 staking)
// Args: poolId, outcome (0 A / 1 B), amount (u64)
// Requires the caller approve this contract for amount prior to calling
export function prediction_placeSingleBet(args: StaticArray<u8>): void {
  whenNotPaused();
  nonReentrant();
  const ar = new Args(args);
  const poolId = ar.nextString().unwrap();
  const outcome = ar.nextI32().unwrap() as i8;
  const amount = ar.nextU64().unwrap();

  assert(hasKey(spoolKey(poolId)), 'pool missing');
  const pRaw = getBytes(spoolKey(poolId));
  const pool = SinglePool.deserialize(pRaw);
  assert(!pool.isClosed, 'pool closed');
  assert(Context.timestamp() < pool.closeTs, 'betting closed');

  // transfer tokens from bettor to contract
  const caller = Context.caller();
  const token = new IERC20(pool.token);
  const allowance = token.allowance(caller, Context.callee());
  assert(allowance >= amount, 'allowance low');
  const bal = token.balanceOf(caller);
  assert(bal >= amount, 'insufficient token balance');

  token.transferFrom(caller, Context.callee(), amount);

  // update pool totals
  pool.totalPool = pool.totalPool + u128.fromU64(amount);
  if (outcome == 0) pool.outcomeABets = pool.outcomeABets + u128.fromU64(amount);
  else pool.outcomeBBets = pool.outcomeBBets + u128.fromU64(amount);

  // save bet
  const bet = new SingleBet();
  bet.bettor = caller;
  bet.poolId = poolId;
  bet.amount = u128.fromU64(amount);
  bet.outcome = outcome;
  bet.isClaimed = false;
  bet.placedAt = Context.timestamp();

  setBytes(spoolKey(poolId), pool.serialize());
  setBytes(sbetKey(poolId, caller.toString()), bet.serialize());
  incrementCounter(TOTAL_BETS_PLACED_KEY);
  endNonReentrant();
  generateEvent('SingleBetPlaced:' + poolId + ':' + caller.toString());
}

// Close single pool and snapshot odds
export function prediction_closeSinglePool(args: StaticArray<u8>): void {
  whenNotPaused();
  nonReentrant();
  const ar = new Args(args);
  const poolId = ar.nextString().unwrap();

  assert(hasKey(spoolKey(poolId)), 'pool not found');
  const pRaw = getBytes(spoolKey(poolId));
  const pool = SinglePool.deserialize(pRaw);
  assert(!pool.isClosed, 'already closed');
  assert(Context.timestamp() >= pool.closeTs, 'too early to close');

  pool.isClosed = true;

  if (pool.totalPool > u128.Zero) {
    // compute house amount & payout pool
    const totalU = pool.totalPool;
    const houseAmount = totalU * u128.fromU64(pool.houseEdgeBps) / u128.fromU64(BASIS_POINTS);
    const payoutPool = totalU - houseAmount;

    if (pool.outcomeABets > u128.Zero) {
      const oddsAfp = payoutPool * ODDS_SCALE_U128 / pool.outcomeABets;
      pool.outcomeAOddsFP = oddsAfp;
    }
    if (pool.outcomeBBets > u128.Zero) {
      const oddsBfp = payoutPool * ODDS_SCALE_U128 / pool.outcomeBBets;
      pool.outcomeBOddsFP = oddsBfp;
    }
  }

  setBytes(spoolKey(poolId), pool.serialize());
  endNonReentrant();
  generateEvent('SinglePoolClosed:' + poolId);
}

// Authorization helper: a settler is authorized if Storage has auth_settler:<addr>
function isAuthorizedSettler(addr: Address): bool {
  return hasKey(AUTH_SETTLER_PREFIX + addr.toString());
}

// settle single pool (only by authorized settler - register Game contract or oracle)
export function prediction_settleSinglePool(args: StaticArray<u8>): void {
  whenNotPaused();
  nonReentrant();
  const ar = new Args(args);
  const poolId = ar.nextString().unwrap();
  const winningOutcome = ar.nextI32().unwrap() as i8; // 0 A, 1 B

  assert(hasKey(spoolKey(poolId)), 'pool missing');
  const pRaw = getBytes(spoolKey(poolId));
  const pool = SinglePool.deserialize(pRaw);

  assert(pool.isClosed, 'pool not closed');
  assert(!pool.isSettled, 'already settled');

  // Authorization: settler must be an authorized address (game or oracle)
  const caller = Context.caller();
  assert(isAuthorizedSettler(caller), 'unauthorized settler');

  pool.isSettled = true;
  pool.winningOutcome = winningOutcome;
  setBytes(spoolKey(poolId), pool.serialize());
  endNonReentrant();
  generateEvent('SinglePoolSettled:' + poolId + ':winner=' + winningOutcome.toString());
}

// claim single bet
export function prediction_claimSingleBet(args: StaticArray<u8>): void {
  whenNotPaused();
  nonReentrant();
  const ar = new Args(args);
  const poolId = ar.nextString().unwrap();
  const bettorAddrStr = ar.nextString().unwrap();
  const bettor = new Address(bettorAddrStr);

  assert(hasKey(spoolKey(poolId)), 'pool missing');
  const pool = SinglePool.deserialize(getBytes(spoolKey(poolId)));
  assert(pool.isSettled, 'pool not settled');
  const betKey = sbetKey(poolId, bettor.toString());
  assert(hasKey(betKey), 'bet not found');
  const bet = SingleBet.deserialize(getBytes(betKey));
  assert(!bet.isClaimed, 'already claimed');
  // if losing bet, mark claimed and exit
  if (bet.outcome != pool.winningOutcome) {
    bet.isClaimed = true;
    setBytes(betKey, bet.serialize());
    incrementCounter(TOTAL_BETS_CLAIMED_KEY);
    endNonReentrant();
    generateEvent('SingleBetClaimed:' + poolId + ':' + bettor.toString() + ':payout=0');
    return;
  }

  // compute payout: payout = floor( payoutPool * bet.amount / totalWinners )
  const totalU = pool.totalPool;
  const houseAmount = totalU * u128.fromU64(pool.houseEdgeBps) / u128.fromU64(BASIS_POINTS);
  const payoutPool = totalU - houseAmount;
  const winnerTotal = pool.winningOutcome == 0 ? pool.outcomeABets : pool.outcomeBBets;
  assert(winnerTotal > u128.Zero, 'no winners in pool');

  const payoutU = payoutPool * bet.amount / winnerTotal; // u128 math
  const payoutU64 = payoutU.toU64(); // Convert to u64 for token transfer

  // mark claimed before transfer (reentrancy guard)
  bet.isClaimed = true;
  setBytes(betKey, bet.serialize());

  // transfer ERC20 tokens from contract to bettor
  const tokenContract = new IERC20(pool.token);
  // ensure contract has balance
  const bal = tokenContract.balanceOf(Context.callee());
  assert(bal >= payoutU64, 'contract insufficient funds');
  tokenContract.transfer(bettor, payoutU64);

  // Increment claimed bets counter
  incrementCounter(TOTAL_BETS_CLAIMED_KEY);

  // Optionally send house fee to treasury (omitted: implement treasury)
  endNonReentrant();
  generateEvent('SingleBetClaimed:' + poolId + ':' + bettor.toString() + ':payout=' + payoutU.toString());
}

// Authorize settler (admin)
export function prediction_setAuthorizedSettler(args: StaticArray<u8>): void {
  onlyRole(ADMIN_ROLE);
  const ar = new Args(args);
  const addr = ar.nextString().unwrap();
  setString(AUTH_SETTLER_PREFIX + addr, '1');
  generateEvent('SettlerAuthorized:' + addr);
}

// Multipool / parlay functions follow the same safety patterns.
// For brevity, here are the key operations (implement details similarly):
// - prediction_createMultipool(multipoolId, token)
// - prediction_placeMultibet(multipoolId, selections[], amount) -> transfers token to contract,
//      computes combined FP odds from authoritative SinglePool outcomeAOddsFP/outcomeBOddsFP (pool must be closed)
// - prediction_accumulateMultibetWinnersBatch(betslipId, remainingPools[]) -> mark betslip.isWinner & add weight to multipool.totalWinnerWeightFP
// - prediction_finalizeMultipool(multipoolId) -> multipool.isFinalized = true
// - prediction_claimMultibet(betslipId) -> payout = floor(payoutPool * weightFP / totalWinnerWeightFP), transfer tokens to bettor
//
// Due to space, implement these following the same patterns: safeTransferFrom, safeTransfer, u128 math, mark claimed before transfer,
// verify remaining_accounts mapping to selections and that each referenced SinglePool is settled and has the expected winningOutcome.

// View helpers to read pool/bet state
export function prediction_readSinglePool(args: StaticArray<u8>): StaticArray<u8> {
  const ar = new Args(args);
  const poolId = ar.nextString().unwrap();
  if (!hasKey(spoolKey(poolId))) return stringToBytes('null');
  return getBytes(spoolKey(poolId));
}

export function prediction_readBet(args: StaticArray<u8>): StaticArray<u8> {
  const ar = new Args(args);
  const poolId = ar.nextString().unwrap();
  const bettor = ar.nextString().unwrap();
  const key = sbetKey(poolId, bettor);
  if (!hasKey(key)) return stringToBytes('null');
  return getBytes(key);
}

// Admin pause
export function prediction_setPaused(args: StaticArray<u8>): void {
  onlyRole(PAUSER_ROLE);
  const ar = new Args(args);
  const paused = ar.nextBool().unwrap();
  setBool(PAUSED_KEY, paused);
  generateEvent('Prediction pause toggled');
}

// View function: get prediction statistics
export function prediction_getStats(_: StaticArray<u8>): StaticArray<u8> {
  const result = new Args();
  result.add(getCounter(SINGLE_POOL_COUNT_KEY));
  result.add(getCounter(MULTIPOOL_COUNT_KEY));
  result.add(getCounter(TOTAL_BETS_PLACED_KEY));
  result.add(getCounter(TOTAL_BETS_CLAIMED_KEY));
  return result.serialize();
}

//////////////////////////////
// Multipool/Parlay Implementation
//////////////////////////////

// Create multipool
export function prediction_createMultipool(args: StaticArray<u8>): void {
  whenNotPaused();
  nonReentrant();
  const ar = new Args(args);
  const multipoolId = ar.nextString().unwrap();
  const tokenAddr = new Address(ar.nextString().unwrap());

  assert(!hasKey(mpoolKey(multipoolId)), 'multipool exists');

  const mp = new Multipool();
  mp.multipoolId = multipoolId;
  mp.token = tokenAddr;
  mp.totalPool = u128.Zero;
  mp.totalWeightFP = u128.Zero;
  mp.totalWinnerWeightFP = u128.Zero;
  mp.isFinalized = false;
  mp.houseEdgeBps = DEFAULT_HOUSE_EDGE_BPS;
  mp.createdAt = Context.timestamp();

  setBytes(mpoolKey(multipoolId), mp.serialize());
  incrementCounter(MULTIPOOL_COUNT_KEY);
  endNonReentrant();
  generateEvent('MultipoolCreated:' + multipoolId);
}

// Place multibet (parlay bet across multiple pools)
export function prediction_placeMultibet(args: StaticArray<u8>): void {
  whenNotPaused();
  nonReentrant();
  const ar = new Args(args);
  const betslipId = ar.nextString().unwrap();
  const multipoolId = ar.nextString().unwrap();
  const amount = ar.nextU64().unwrap();
  const selectionsCount = ar.nextU32().unwrap();

  // Parse selections
  const selections: string[] = [];
  let combinedOddsFP: u128 = ODDS_SCALE_U128; // Start with 1.0 in FP

  for (let i: u32 = 0; i < selectionsCount; i++) {
    const poolId = ar.nextString().unwrap();
    const outcome = ar.nextI32().unwrap() as i8;

    // Verify pool exists and is closed (odds finalized)
    assert(hasKey(spoolKey(poolId)), 'pool ' + poolId + ' missing');
    const pool = SinglePool.deserialize(getBytes(spoolKey(poolId)));
    assert(pool.isClosed, 'pool ' + poolId + ' not closed');

    // Get odds for this outcome
    const oddsFP = outcome == 0 ? pool.outcomeAOddsFP : pool.outcomeBOddsFP;
    assert(oddsFP > u128.Zero, 'invalid odds for pool ' + poolId);

    // Multiply combined odds (FP math: multiply then divide by scale)
    combinedOddsFP = combinedOddsFP * oddsFP / ODDS_SCALE_U128;

    // Store selection
    const sel = new BetslipSelection();
    sel.poolId = poolId;
    sel.outcome = outcome;
    sel.oddsFP = oddsFP;
    selections.push(sel.toString());
  }

  // Transfer tokens from bettor
  const caller = Context.caller();
  assert(hasKey(mpoolKey(multipoolId)), 'multipool missing');
  const mp = Multipool.deserialize(getBytes(mpoolKey(multipoolId)));

  const token = new IERC20(mp.token);
  const allowance = token.allowance(caller, Context.callee());
  assert(allowance >= amount, 'allowance low');
  const bal = token.balanceOf(caller);
  assert(bal >= amount, 'insufficient balance');

  token.transferFrom(caller, Context.callee(), amount);

  // Create betslip
  const betslip = new Betslip();
  betslip.betslipId = betslipId;
  betslip.bettor = caller;
  betslip.multipoolId = multipoolId;
  betslip.amount = u128.fromU64(amount);
  betslip.selections = selections;
  betslip.combinedOddsFP = combinedOddsFP;
  // Weight = amount * combinedOddsFP (simplified parlay weight)
  betslip.weightFP = u128.fromU64(amount) * combinedOddsFP / ODDS_SCALE_U128;
  betslip.isWinner = false;
  betslip.isClaimed = false;
  betslip.isAccounted = false;
  betslip.placedAt = Context.timestamp();

  // Update multipool totals
  mp.totalPool = mp.totalPool + u128.fromU64(amount);
  mp.totalWeightFP = mp.totalWeightFP + betslip.weightFP;

  setBytes(mpoolKey(multipoolId), mp.serialize());
  setBytes(betslipKey(betslipId), betslip.serialize());
  incrementCounter(TOTAL_BETS_PLACED_KEY);
  endNonReentrant();
  generateEvent('MultibetPlaced:' + betslipId + ':multipool=' + multipoolId);
}

// Check if betslip is winner (all selections correct)
export function prediction_checkBetslipWinner(args: StaticArray<u8>): void {
  whenNotPaused();
  nonReentrant();
  const ar = new Args(args);
  const betslipId = ar.nextString().unwrap();

  assert(hasKey(betslipKey(betslipId)), 'betslip missing');
  const betslip = Betslip.deserialize(getBytes(betslipKey(betslipId)));
  assert(!betslip.isAccounted, 'already accounted');

  // Check all selections
  let isWinner = true;
  for (let i = 0; i < betslip.selections.length; i++) {
    const sel = BetslipSelection.fromString(betslip.selections[i]);

    assert(hasKey(spoolKey(sel.poolId)), 'pool missing');
    const pool = SinglePool.deserialize(getBytes(spoolKey(sel.poolId)));
    assert(pool.isSettled, 'pool not settled');

    if (pool.winningOutcome != sel.outcome) {
      isWinner = false;
      break;
    }
  }

  betslip.isWinner = isWinner;
  betslip.isAccounted = true;

  // If winner, add to multipool winner weight
  if (isWinner) {
    assert(hasKey(mpoolKey(betslip.multipoolId)), 'multipool missing');
    const mp = Multipool.deserialize(getBytes(mpoolKey(betslip.multipoolId)));
    mp.totalWinnerWeightFP = mp.totalWinnerWeightFP + betslip.weightFP;
    setBytes(mpoolKey(betslip.multipoolId), mp.serialize());
  }

  setBytes(betslipKey(betslipId), betslip.serialize());
  endNonReentrant();
  generateEvent('BetslipChecked:' + betslipId + ':winner=' + (isWinner ? '1' : '0'));
}

// Finalize multipool (after all betslips checked)
export function prediction_finalizeMultipool(args: StaticArray<u8>): void {
  whenNotPaused();
  nonReentrant();
  onlyRole(ADMIN_ROLE); // Or authorized settler
  const ar = new Args(args);
  const multipoolId = ar.nextString().unwrap();

  assert(hasKey(mpoolKey(multipoolId)), 'multipool missing');
  const mp = Multipool.deserialize(getBytes(mpoolKey(multipoolId)));
  assert(!mp.isFinalized, 'already finalized');

  mp.isFinalized = true;
  setBytes(mpoolKey(multipoolId), mp.serialize());
  endNonReentrant();
  generateEvent('MultipoolFinalized:' + multipoolId);
}

// Claim multibet winnings
export function prediction_claimMultibet(args: StaticArray<u8>): void {
  whenNotPaused();
  nonReentrant();
  const ar = new Args(args);
  const betslipId = ar.nextString().unwrap();

  assert(hasKey(betslipKey(betslipId)), 'betslip missing');
  const betslip = Betslip.deserialize(getBytes(betslipKey(betslipId)));
  assert(!betslip.isClaimed, 'already claimed');
  assert(betslip.isAccounted, 'not yet accounted');

  assert(hasKey(mpoolKey(betslip.multipoolId)), 'multipool missing');
  const mp = Multipool.deserialize(getBytes(mpoolKey(betslip.multipoolId)));
  assert(mp.isFinalized, 'multipool not finalized');

  // If not winner, just mark claimed
  if (!betslip.isWinner) {
    betslip.isClaimed = true;
    setBytes(betslipKey(betslipId), betslip.serialize());
    incrementCounter(TOTAL_BETS_CLAIMED_KEY);
    endNonReentrant();
    generateEvent('MultibetClaimed:' + betslipId + ':payout=0');
    return;
  }

  // Calculate payout
  const totalU = mp.totalPool;
  const houseAmount = totalU * u128.fromU64(mp.houseEdgeBps) / u128.fromU64(BASIS_POINTS);
  const payoutPool = totalU - houseAmount;

  assert(mp.totalWinnerWeightFP > u128.Zero, 'no winners');
  const payoutU = payoutPool * betslip.weightFP / mp.totalWinnerWeightFP;
  const payoutU64 = payoutU.toU64(); // Convert to u64 for token transfer

  // Mark claimed before transfer
  betslip.isClaimed = true;
  setBytes(betslipKey(betslipId), betslip.serialize());

  // Transfer tokens
  const token = new IERC20(mp.token);
  const bal = token.balanceOf(Context.callee());
  assert(bal >= payoutU64, 'contract insufficient funds');
  token.transfer(betslip.bettor, payoutU64);

  incrementCounter(TOTAL_BETS_CLAIMED_KEY);
  endNonReentrant();
  generateEvent('MultibetClaimed:' + betslipId + ':payout=' + payoutU.toString());
}

// View functions for multipool
export function prediction_readMultipool(args: StaticArray<u8>): StaticArray<u8> {
  const ar = new Args(args);
  const multipoolId = ar.nextString().unwrap();
  if (!hasKey(mpoolKey(multipoolId))) return stringToBytes('null');
  return getBytes(mpoolKey(multipoolId));
}

export function prediction_readBetslip(args: StaticArray<u8>): StaticArray<u8> {
  const ar = new Args(args);
  const betslipId = ar.nextString().unwrap();
  if (!hasKey(betslipKey(betslipId))) return stringToBytes('null');
  return getBytes(betslipKey(betslipId));
}

/*
  Notes & Next Steps:
  - The above provides core patterns and functions to implement the game and prediction/betting contracts on Massa AssemblyScript.
  - For production: replace simple_random with a secure VRF integration (Cadence equivalent on Massa if provided or oracle), implement treasury, refund/cancel flows,
    add robust multipool batch implementation, add exact serialization sizes, and write full unit tests and integration tests.
  - Also implement MP token support, careful gas and storage sizing, and off-chain indexer to assist in multipool accumulation and UI.
*/

/* End of artifact */