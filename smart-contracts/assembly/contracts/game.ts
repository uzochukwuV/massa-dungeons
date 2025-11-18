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
export const EQUIPMENT_COUNT_KEY = 'equipment_count';

// Treasury keys
export const TREASURY_BALANCE_KEY = 'treasury_balance';
export const TREASURY_WITHDRAWN_KEY = 'treasury_withdrawn';

// Status effect types (used as bitmask)
export const STATUS_NONE: u8 = 0;
export const STATUS_POISON: u8 = 1; // DOT: 5% max HP per turn
export const STATUS_STUN: u8 = 2; // Skip next turn
export const STATUS_SHIELD: u8 = 4; // 30% damage reduction
export const STATUS_RAGE: u8 = 8; // 50% damage increase
export const STATUS_BURN: u8 = 16; // DOT: 8% max HP per turn

// Equipment rarity
export const RARITY_COMMON: u8 = 0;
export const RARITY_RARE: u8 = 1;
export const RARITY_EPIC: u8 = 2;
export const RARITY_LEGENDARY: u8 = 3;

// Skill types
export const SKILL_NONE: u8 = 0;
export const SKILL_POWER_STRIKE: u8 = 1; // 150% damage, 3 turn cooldown
export const SKILL_HEAL: u8 = 2; // Restore 30% HP, 4 turn cooldown
export const SKILL_POISON_STRIKE: u8 = 3; // Apply poison, 2 turn cooldown
export const SKILL_STUN_STRIKE: u8 = 4; // Apply stun, 5 turn cooldown
export const SKILL_SHIELD_WALL: u8 = 5; // Apply shield, 3 turn cooldown
export const SKILL_RAGE_MODE: u8 = 6; // Apply rage, 4 turn cooldown
export const SKILL_CRITICAL_EYE: u8 = 7; // Guarantee next hit is crit, 6 turn cooldown
export const SKILL_DODGE_MASTER: u8 = 8; // +50% dodge for 2 turns, 5 turn cooldown
export const SKILL_BURN_AURA: u8 = 9; // Apply burn, 3 turn cooldown
export const SKILL_COMBO_BREAKER: u8 = 10; // Reset enemy combo + deal damage, 4 turn cooldown

// Skill costs (energy points)
export const MAX_ENERGY: u8 = 100;
export const ENERGY_PER_TURN: u8 = 20; // Regenerate 20 energy per turn

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
 * - Equipment system with NFT support
 * - Status effects (Poison, Stun, Shield, Rage, Burn)
 * - Combo system for consecutive attacks
 */

// Equipment NFT class
export class Equipment {
  equipmentId: string; // unique ID
  owner: Address;
  type: u8; // 0=Weapon, 1=Armor, 2=Accessory
  rarity: u8; // 0=Common, 1=Rare, 2=Epic, 3=Legendary
  hpBonus: u64;
  damageMinBonus: u16;
  damageMaxBonus: u16;
  critBonus: u16;
  dodgeBonus: u16;
  durability: u16; // Max uses before breaking
  currentDurability: u16;
  createdAt: u64;

  constructor() {
    this.equipmentId = '';
    this.owner = new Address('0');
    this.type = 0;
    this.rarity = 0;
    this.hpBonus = 0;
    this.damageMinBonus = 0;
    this.damageMaxBonus = 0;
    this.critBonus = 0;
    this.dodgeBonus = 0;
    this.durability = 100;
    this.currentDurability = 100;
    this.createdAt = 0;
  }

  serialize(): StaticArray<u8> {
    const a = new Args();
    a.add(this.equipmentId);
    a.add(this.owner.toString());
    a.add(this.type);
    a.add(this.rarity);
    a.add(this.hpBonus);
    a.add(this.damageMinBonus as u32);
    a.add(this.damageMaxBonus as u32);
    a.add(this.critBonus as u32);
    a.add(this.dodgeBonus as u32);
    a.add(this.durability as u32);
    a.add(this.currentDurability as u32);
    a.add(this.createdAt);
    return a.serialize();
  }

  static deserialize(data: StaticArray<u8>): Equipment {
    const a = new Args(data);
    const e = new Equipment();
    e.equipmentId = a.nextString().unwrap();
    e.owner = new Address(a.nextString().unwrap());
    e.type = a.nextU8().unwrap();
    e.rarity = a.nextU8().unwrap();
    e.hpBonus = a.nextU64().unwrap();
    e.damageMinBonus = a.nextU32().unwrap() as u16;
    e.damageMaxBonus = a.nextU32().unwrap() as u16;
    e.critBonus = a.nextU32().unwrap() as u16;
    e.dodgeBonus = a.nextU32().unwrap() as u16;
    e.durability = a.nextU32().unwrap() as u16;
    e.currentDurability = a.nextU32().unwrap() as u16;
    e.createdAt = a.nextU64().unwrap();
    return e;
  }
}

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
  // Equipment slots (IDs of equipped items)
  weaponId: string;
  armorId: string;
  accessoryId: string;
  // Skill system
  skill1: u8; // Equipped skill slot 1
  skill2: u8; // Equipped skill slot 2
  skill3: u8; // Equipped skill slot 3
  learnedSkills: string; // Comma-separated list of learned skill IDs
  currentEnergy: u8; // Current energy points (max 100)

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
    this.weaponId = '';
    this.armorId = '';
    this.accessoryId = '';
    this.skill1 = SKILL_NONE;
    this.skill2 = SKILL_NONE;
    this.skill3 = SKILL_NONE;
    this.learnedSkills = '';
    this.currentEnergy = MAX_ENERGY;
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
    a.add(this.weaponId);
    a.add(this.armorId);
    a.add(this.accessoryId);
    a.add(this.skill1);
    a.add(this.skill2);
    a.add(this.skill3);
    a.add(this.learnedSkills);
    a.add(this.currentEnergy);
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
    c.weaponId = a.nextString().unwrap();
    c.armorId = a.nextString().unwrap();
    c.accessoryId = a.nextString().unwrap();
    c.skill1 = a.nextU8().unwrap();
    c.skill2 = a.nextU8().unwrap();
    c.skill3 = a.nextU8().unwrap();
    c.learnedSkills = a.nextString().unwrap();
    c.currentEnergy = a.nextU8().unwrap();
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
  // Status effects (bitmask)
  player1StatusEffects: u8;
  player2StatusEffects: u8;
  player1StatusDuration: u8; // Turns remaining
  player2StatusDuration: u8;
  // Combo tracking
  player1ComboCount: u8;
  player2ComboCount: u8;
  // Skill cooldowns (turns remaining)
  player1Skill1Cooldown: u8;
  player1Skill2Cooldown: u8;
  player1Skill3Cooldown: u8;
  player2Skill1Cooldown: u8;
  player2Skill2Cooldown: u8;
  player2Skill3Cooldown: u8;

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
    this.player1StatusEffects = STATUS_NONE;
    this.player2StatusEffects = STATUS_NONE;
    this.player1StatusDuration = 0;
    this.player2StatusDuration = 0;
    this.player1ComboCount = 0;
    this.player2ComboCount = 0;
    this.player1Skill1Cooldown = 0;
    this.player1Skill2Cooldown = 0;
    this.player1Skill3Cooldown = 0;
    this.player2Skill1Cooldown = 0;
    this.player2Skill2Cooldown = 0;
    this.player2Skill3Cooldown = 0;
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
    a.add(this.player1StatusEffects);
    a.add(this.player2StatusEffects);
    a.add(this.player1StatusDuration);
    a.add(this.player2StatusDuration);
    a.add(this.player1ComboCount);
    a.add(this.player2ComboCount);
    a.add(this.player1Skill1Cooldown);
    a.add(this.player1Skill2Cooldown);
    a.add(this.player1Skill3Cooldown);
    a.add(this.player2Skill1Cooldown);
    a.add(this.player2Skill2Cooldown);
    a.add(this.player2Skill3Cooldown);
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
    b.player1StatusEffects = a.nextU8().unwrap();
    b.player2StatusEffects = a.nextU8().unwrap();
    b.player1StatusDuration = a.nextU8().unwrap();
    b.player2StatusDuration = a.nextU8().unwrap();
    b.player1ComboCount = a.nextU8().unwrap();
    b.player2ComboCount = a.nextU8().unwrap();
    b.player1Skill1Cooldown = a.nextU8().unwrap();
    b.player1Skill2Cooldown = a.nextU8().unwrap();
    b.player1Skill3Cooldown = a.nextU8().unwrap();
    b.player2Skill1Cooldown = a.nextU8().unwrap();
    b.player2Skill2Cooldown = a.nextU8().unwrap();
    b.player2Skill3Cooldown = a.nextU8().unwrap();
    return b;
  }
}

// Storage prefixes
const CHARACTER_PREFIX = 'character:'; // character:<id> -> serialized Character
const BATTLE_PREFIX = 'battle:';       // battle:<id> -> serialized Battle
const EQUIPMENT_PREFIX = 'equipment:'; // equipment:<id> -> serialized Equipment
const GAME_AUTH_SETTLER = 'game:auth_settler:'; // set by admin: {settlerAddress:true}
const BETTING_STREAK_PREFIX = 'streak:'; // streak:<address> -> win streak counter

// Helpers
function characterKey(id: string): string { return CHARACTER_PREFIX + id; }
function battleKey(id: string): string { return BATTLE_PREFIX + id; }
function equipmentKey(id: string): string { return EQUIPMENT_PREFIX + id; }
function streakKey(addr: Address): string { return BETTING_STREAK_PREFIX + addr.toString(); }

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
  const skillSlot = ar.nextU8().unwrap(); // 0 = no skill, 1-3 = use skill from that slot

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

  // compute damage (with equipment, status effects, and combo system)
  // load characters to get stats
  const c1Raw = getBytes(characterKey(battle.player1Char.toString()));
  const c2Raw = getBytes(characterKey(battle.player2Char.toString()));
  const c1 = Character.deserialize(c1Raw);
  const c2 = Character.deserialize(c2Raw);

  const attacker = isPlayer1 ? c1 : c2;
  const defender = isPlayer1 ? c2 : c1;

  // Load equipped items and apply stat bonuses
  let attackerDamageMinBonus: u16 = 0;
  let attackerDamageMaxBonus: u16 = 0;
  let attackerCritBonus: u16 = 0;
  let defenderDodgeBonus: u16 = 0;

  // Load attacker's equipment
  if (attacker.weaponId.length > 0 && hasKey(equipmentKey(attacker.weaponId))) {
    const weaponRaw = getBytes(equipmentKey(attacker.weaponId));
    const weapon = Equipment.deserialize(weaponRaw);
    attackerDamageMinBonus += weapon.damageMinBonus;
    attackerDamageMaxBonus += weapon.damageMaxBonus;
    attackerCritBonus += weapon.critBonus;
  }
  if (attacker.accessoryId.length > 0 && hasKey(equipmentKey(attacker.accessoryId))) {
    const accessoryRaw = getBytes(equipmentKey(attacker.accessoryId));
    const accessory = Equipment.deserialize(accessoryRaw);
    attackerCritBonus += accessory.critBonus;
  }

  // Load defender's equipment
  if (defender.armorId.length > 0 && hasKey(equipmentKey(defender.armorId))) {
    const armorRaw = getBytes(equipmentKey(defender.armorId));
    const armor = Equipment.deserialize(armorRaw);
    defenderDodgeBonus += armor.dodgeBonus;
  }
  if (defender.accessoryId.length > 0 && hasKey(equipmentKey(defender.accessoryId))) {
    const accessoryRaw = getBytes(equipmentKey(defender.accessoryId));
    const accessory = Equipment.deserialize(accessoryRaw);
    defenderDodgeBonus += accessory.dodgeBonus;
  }

  // Skill execution logic
  let skillUsed: u8 = SKILL_NONE;
  let skillDamageMultiplier: u16 = 100; // 100 = 1.0x
  let skillForceCrit = false;
  let skillDodgeBonus: u16 = 0;

  if (skillSlot >= 1 && skillSlot <= 3) {
    // Get equipped skill
    const equippedSkill = skillSlot == 1 ? attacker.skill1 : (skillSlot == 2 ? attacker.skill2 : attacker.skill3);

    if (equippedSkill != SKILL_NONE) {
      // Check cooldown
      let currentCooldown: u8 = 0;
      if (isPlayer1) {
        currentCooldown = skillSlot == 1 ? battle.player1Skill1Cooldown : (skillSlot == 2 ? battle.player1Skill2Cooldown : battle.player1Skill3Cooldown);
      } else {
        currentCooldown = skillSlot == 1 ? battle.player2Skill1Cooldown : (skillSlot == 2 ? battle.player2Skill2Cooldown : battle.player2Skill3Cooldown);
      }

      if (currentCooldown == 0) {
        const energyCost = getSkillEnergyCost(equippedSkill);
        if (attacker.currentEnergy >= energyCost) {
          skillUsed = equippedSkill;
          attacker.currentEnergy -= energyCost;

          // Apply skill effects
          if (skillUsed == SKILL_POWER_STRIKE) {
            skillDamageMultiplier = 150; // 1.5x damage
          } else if (skillUsed == SKILL_HEAL) {
            const healAmount = attacker.maxHp * 30 / 100;
            attacker.currentHp = attacker.currentHp + healAmount > attacker.maxHp ? attacker.maxHp : attacker.currentHp + healAmount;
            if (isPlayer1) {
              battle.player1Hp = attacker.currentHp;
            } else {
              battle.player2Hp = attacker.currentHp;
            }
          } else if (skillUsed == SKILL_POISON_STRIKE) {
            if (isPlayer1) {
              battle.player2StatusEffects |= STATUS_POISON;
              battle.player2StatusDuration = 3;
            } else {
              battle.player1StatusEffects |= STATUS_POISON;
              battle.player1StatusDuration = 3;
            }
          } else if (skillUsed == SKILL_STUN_STRIKE) {
            if (isPlayer1) {
              battle.player2StatusEffects |= STATUS_STUN;
              battle.player2StatusDuration = 1;
            } else {
              battle.player1StatusEffects |= STATUS_STUN;
              battle.player1StatusDuration = 1;
            }
          } else if (skillUsed == SKILL_SHIELD_WALL) {
            if (isPlayer1) {
              battle.player1StatusEffects |= STATUS_SHIELD;
              battle.player1StatusDuration = 2;
            } else {
              battle.player2StatusEffects |= STATUS_SHIELD;
              battle.player2StatusDuration = 2;
            }
          } else if (skillUsed == SKILL_RAGE_MODE) {
            if (isPlayer1) {
              battle.player1StatusEffects |= STATUS_RAGE;
              battle.player1StatusDuration = 2;
            } else {
              battle.player2StatusEffects |= STATUS_RAGE;
              battle.player2StatusDuration = 2;
            }
          } else if (skillUsed == SKILL_CRITICAL_EYE) {
            skillForceCrit = true;
          } else if (skillUsed == SKILL_DODGE_MASTER) {
            skillDodgeBonus = 50; // +50% dodge
            if (isPlayer1) {
              battle.player1StatusEffects |= STATUS_SHIELD; // Reuse shield for visual indication
              battle.player1StatusDuration = 2;
            } else {
              battle.player2StatusEffects |= STATUS_SHIELD;
              battle.player2StatusDuration = 2;
            }
          } else if (skillUsed == SKILL_BURN_AURA) {
            if (isPlayer1) {
              battle.player2StatusEffects |= STATUS_BURN;
              battle.player2StatusDuration = 3;
            } else {
              battle.player1StatusEffects |= STATUS_BURN;
              battle.player1StatusDuration = 3;
            }
          } else if (skillUsed == SKILL_COMBO_BREAKER) {
            // Reset enemy combo and deal bonus damage
            if (isPlayer1) {
              battle.player2ComboCount = 0;
            } else {
              battle.player1ComboCount = 0;
            }
            skillDamageMultiplier = 120; // 1.2x damage
          }

          // Set cooldown
          const cooldown = getSkillCooldown(skillUsed);
          if (isPlayer1) {
            if (skillSlot == 1) battle.player1Skill1Cooldown = cooldown;
            else if (skillSlot == 2) battle.player1Skill2Cooldown = cooldown;
            else battle.player1Skill3Cooldown = cooldown;
          } else {
            if (skillSlot == 1) battle.player2Skill1Cooldown = cooldown;
            else if (skillSlot == 2) battle.player2Skill2Cooldown = cooldown;
            else battle.player2Skill3Cooldown = cooldown;
          }

          // Save attacker energy
          if (isPlayer1) {
            setBytes(characterKey(battle.player1Char.toString()), c1.serialize());
          } else {
            setBytes(characterKey(battle.player2Char.toString()), c2.serialize());
          }
        }
      }
    }
  }

  // Regenerate energy each turn (both players)
  if (c1.currentEnergy < MAX_ENERGY) {
    c1.currentEnergy = c1.currentEnergy + ENERGY_PER_TURN > MAX_ENERGY ? MAX_ENERGY : c1.currentEnergy + ENERGY_PER_TURN;
  }
  if (c2.currentEnergy < MAX_ENERGY) {
    c2.currentEnergy = c2.currentEnergy + ENERGY_PER_TURN > MAX_ENERGY ? MAX_ENERGY : c2.currentEnergy + ENERGY_PER_TURN;
  }

  // Check for STUN status on attacker - skip turn if stunned
  const attackerStatus = isPlayer1 ? battle.player1StatusEffects : battle.player2StatusEffects;
  const attackerStatusDuration = isPlayer1 ? battle.player1StatusDuration : battle.player2StatusDuration;

  if ((attackerStatus & STATUS_STUN) != 0) {
    // Attacker is stunned - skip damage phase
    // Decrement status duration
    if (isPlayer1) {
      if (battle.player1StatusDuration > 0) {
        battle.player1StatusDuration -= 1;
        if (battle.player1StatusDuration == 0) {
          battle.player1StatusEffects = STATUS_NONE;
        }
      }
    } else {
      if (battle.player2StatusDuration > 0) {
        battle.player2StatusDuration -= 1;
        if (battle.player2StatusDuration == 0) {
          battle.player2StatusEffects = STATUS_NONE;
        }
      }
    }
    // Skip to end of turn
    battle.turnNumber += 1;
    battle.currentTurn = battle.currentTurn == 1 ? 2 : 1;
    setBytes(battleKey(battleId), battle.serialize());
    endNonReentrant();
    generateEvent('TurnExecuted:' + battleId + ':Stunned');
    return;
  }

  // damage base with equipment bonuses
  const totalDamageMin = attacker.baseDamageMin + attackerDamageMinBonus;
  const totalDamageMax = attacker.baseDamageMax + attackerDamageMaxBonus;
  const dmgRange = totalDamageMax > totalDamageMin ? totalDamageMax - totalDamageMin : 0;
  let rollDamage = (simple_random(battle.turnNumber as u64 + Context.timestamp(), 3) % (dmgRange as u64 + 1)) as u16;
  let baseDamage = totalDamageMin + rollDamage;
  // level bonus
  baseDamage = baseDamage + (attacker.level - 1) * 2;

  // Apply RAGE status - 50% damage increase
  if ((attackerStatus & STATUS_RAGE) != 0) {
    baseDamage = baseDamage + baseDamage / 2;
  }

  // Apply skill damage multiplier
  if (skillDamageMultiplier != 100) {
    baseDamage = (baseDamage as u64 * skillDamageMultiplier as u64 / 100) as u16;
  }

  // crit check with equipment bonus
  const totalCritChance = attacker.critChance + attackerCritBonus;
  const critRoll = (simple_random(battle.turnNumber as u64 + Context.timestamp(), 4) % 100) as u16;
  let damage = baseDamage as u64;
  if (skillForceCrit || critRoll < totalCritChance) {
    damage = damage * 2;
  }

  // Apply combo multiplier if combo >= 3
  const attackerCombo = isPlayer1 ? battle.player1ComboCount : battle.player2ComboCount;
  if (attackerCombo >= 3) {
    damage = damage + damage / 5; // 20% bonus
  }

  // apply defense and dodge with equipment bonus (add skill dodge bonus)
  const totalDodgeChance = defender.dodgeChance + defenderDodgeBonus + skillDodgeBonus;
  let dodged = false;
  if ((simple_random(battle.turnNumber as u64 + Context.timestamp(), 6) % 100) < totalDodgeChance) {
    damage = 0;
    dodged = true;
  } else {
    damage = damage > defender.defense as u64 ? damage - defender.defense as u64 : 0;
  }

  // Apply SHIELD status on defender - 30% damage reduction
  const defenderStatus = isPlayer1 ? battle.player2StatusEffects : battle.player1StatusEffects;
  if ((defenderStatus & STATUS_SHIELD) != 0 && damage > 0) {
    damage = damage - damage * 30 / 100;
  }

  // Apply damage and update combo counters
  if (isPlayer1) {
    battle.player2Hp = battle.player2Hp > damage ? battle.player2Hp - damage : 0;
    if (damage > 0 && !dodged) {
      // Successful hit - increment attacker combo, reset defender combo
      battle.player1ComboCount = battle.player1ComboCount < 255 ? battle.player1ComboCount + 1 : 255;
      battle.player2ComboCount = 0;
    } else {
      // Miss or dodge - reset attacker combo
      battle.player1ComboCount = 0;
    }
  } else {
    battle.player1Hp = battle.player1Hp > damage ? battle.player1Hp - damage : 0;
    if (damage > 0 && !dodged) {
      battle.player2ComboCount = battle.player2ComboCount < 255 ? battle.player2ComboCount + 1 : 255;
      battle.player1ComboCount = 0;
    } else {
      battle.player2ComboCount = 0;
    }
  }

  // Apply POISON and BURN DOT effects
  const p1Status = battle.player1StatusEffects;
  const p2Status = battle.player2StatusEffects;

  // Apply POISON to player 1 (5% max HP per turn)
  if ((p1Status & STATUS_POISON) != 0) {
    const dotDamage = c1.maxHp / 20; // 5%
    battle.player1Hp = battle.player1Hp > dotDamage ? battle.player1Hp - dotDamage : 0;
  }

  // Apply BURN to player 1 (8% max HP per turn)
  if ((p1Status & STATUS_BURN) != 0) {
    const dotDamage = c1.maxHp * 8 / 100;
    battle.player1Hp = battle.player1Hp > dotDamage ? battle.player1Hp - dotDamage : 0;
  }

  // Apply POISON to player 2 (5% max HP per turn)
  if ((p2Status & STATUS_POISON) != 0) {
    const dotDamage = c2.maxHp / 20; // 5%
    battle.player2Hp = battle.player2Hp > dotDamage ? battle.player2Hp - dotDamage : 0;
  }

  // Apply BURN to player 2 (8% max HP per turn)
  if ((p2Status & STATUS_BURN) != 0) {
    const dotDamage = c2.maxHp * 8 / 100;
    battle.player2Hp = battle.player2Hp > dotDamage ? battle.player2Hp - dotDamage : 0;
  }

  // Decrement status durations for both players
  if (battle.player1StatusDuration > 0) {
    battle.player1StatusDuration -= 1;
    if (battle.player1StatusDuration == 0) {
      battle.player1StatusEffects = STATUS_NONE;
    }
  }
  if (battle.player2StatusDuration > 0) {
    battle.player2StatusDuration -= 1;
    if (battle.player2StatusDuration == 0) {
      battle.player2StatusEffects = STATUS_NONE;
    }
  }

  battle.turnNumber += 1;
  battle.currentTurn = battle.currentTurn == 1 ? 2 : 1;

  // Decrement skill cooldowns for both players
  if (battle.player1Skill1Cooldown > 0) battle.player1Skill1Cooldown -= 1;
  if (battle.player1Skill2Cooldown > 0) battle.player1Skill2Cooldown -= 1;
  if (battle.player1Skill3Cooldown > 0) battle.player1Skill3Cooldown -= 1;
  if (battle.player2Skill1Cooldown > 0) battle.player2Skill1Cooldown -= 1;
  if (battle.player2Skill2Cooldown > 0) battle.player2Skill2Cooldown -= 1;
  if (battle.player2Skill3Cooldown > 0) battle.player2Skill3Cooldown -= 1;

  // Save character states (energy regeneration)
  setBytes(characterKey(battle.player1Char.toString()), c1.serialize());
  setBytes(characterKey(battle.player2Char.toString()), c2.serialize());

  // check finish
  if (battle.player1Hp == 0 || battle.player2Hp == 0) {
    battle.isFinished = true;
    battle.winner = battle.player1Hp > 0 ? 1 : 2;
    generateEvent('BattleEnded:' + battleId);
  }

  setBytes(battleKey(battleId), battle.serialize());
  endNonReentrant();
  const skillEvent = skillUsed != SKILL_NONE ? ':skill=' + skillUsed.toString() : '';
  generateEvent('TurnExecuted:' + battleId + skillEvent);
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

// ============================================================================
// EQUIPMENT SYSTEM
// ============================================================================

// Create equipment (admin or from battle rewards)
export function game_createEquipment(args: StaticArray<u8>): void {
  whenNotPaused();
  nonReentrant();
  onlyRole(ADMIN_ROLE); // Or could be called by battle system
  const ar = new Args(args);
  const equipmentId = ar.nextString().unwrap();
  const ownerAddr = new Address(ar.nextString().unwrap());
  const type = ar.nextU8().unwrap();
  const rarity = ar.nextU8().unwrap();

  assert(!hasKey(equipmentKey(equipmentId)), 'equipment exists');

  const equip = new Equipment();
  equip.equipmentId = equipmentId;
  equip.owner = ownerAddr;
  equip.type = type;
  equip.rarity = rarity;
  equip.createdAt = Context.timestamp();

  // Set stats based on rarity
  switch (rarity) {
    case RARITY_COMMON:
      equip.hpBonus = 10;
      equip.damageMinBonus = 1;
      equip.damageMaxBonus = 2;
      equip.critBonus = 2;
      equip.dodgeBonus = 1;
      equip.durability = 100;
      break;
    case RARITY_RARE:
      equip.hpBonus = 25;
      equip.damageMinBonus = 3;
      equip.damageMaxBonus = 5;
      equip.critBonus = 5;
      equip.dodgeBonus = 3;
      equip.durability = 200;
      break;
    case RARITY_EPIC:
      equip.hpBonus = 50;
      equip.damageMinBonus = 5;
      equip.damageMaxBonus = 10;
      equip.critBonus = 10;
      equip.dodgeBonus = 5;
      equip.durability = 300;
      break;
    case RARITY_LEGENDARY:
      equip.hpBonus = 100;
      equip.damageMinBonus = 10;
      equip.damageMaxBonus = 20;
      equip.critBonus = 15;
      equip.dodgeBonus = 10;
      equip.durability = 500;
      break;
  }
  equip.currentDurability = equip.durability;

  setBytes(equipmentKey(equipmentId), equip.serialize());
  incrementCounter(EQUIPMENT_COUNT_KEY);
  endNonReentrant();
  generateEvent('EquipmentCreated:' + equipmentId + ':rarity=' + rarity.toString());
}

// Equip item to character
export function game_equipItem(args: StaticArray<u8>): void {
  whenNotPaused();
  nonReentrant();
  const ar = new Args(args);
  const charId = ar.nextString().unwrap();
  const equipmentId = ar.nextString().unwrap();

  assert(hasKey(characterKey(charId)), 'character not found');
  assert(hasKey(equipmentKey(equipmentId)), 'equipment not found');

  const char = Character.deserialize(getBytes(characterKey(charId)));
  const equip = Equipment.deserialize(getBytes(equipmentKey(equipmentId)));

  const caller = Context.caller();
  assert(caller.toString() == char.owner.toString(), 'not character owner');
  assert(caller.toString() == equip.owner.toString(), 'not equipment owner');

  // Equip based on type
  if (equip.type == 0) char.weaponId = equipmentId;
  else if (equip.type == 1) char.armorId = equipmentId;
  else if (equip.type == 2) char.accessoryId = equipmentId;

  setBytes(characterKey(charId), char.serialize());
  endNonReentrant();
  generateEvent('ItemEquipped:' + charId + ':' + equipmentId);
}

// Transfer equipment NFT
export function game_transferEquipment(args: StaticArray<u8>): void {
  whenNotPaused();
  nonReentrant();
  const ar = new Args(args);
  const equipmentId = ar.nextString().unwrap();
  const toAddr = new Address(ar.nextString().unwrap());

  assert(hasKey(equipmentKey(equipmentId)), 'equipment not found');
  const equip = Equipment.deserialize(getBytes(equipmentKey(equipmentId)));

  const caller = Context.caller();
  assert(caller.toString() == equip.owner.toString(), 'not owner');

  equip.owner = toAddr;
  setBytes(equipmentKey(equipmentId), equip.serialize());
  endNonReentrant();
  generateEvent('EquipmentTransferred:' + equipmentId);
}

// Read equipment
export function game_readEquipment(args: StaticArray<u8>): StaticArray<u8> {
  const ar = new Args(args);
  const equipmentId = ar.nextString().unwrap();
  if (!hasKey(equipmentKey(equipmentId))) return stringToBytes('null');
  return getBytes(equipmentKey(equipmentId));
}

// ============================================================================
// SKILL SYSTEM
// ============================================================================

// Learn a new skill (costs XP or tokens)
export function game_learnSkill(args: StaticArray<u8>): void {
  whenNotPaused();
  nonReentrant();
  const ar = new Args(args);
  const characterId = ar.nextString().unwrap();
  const skillId = ar.nextU8().unwrap();

  assert(skillId > SKILL_NONE && skillId <= SKILL_COMBO_BREAKER, 'invalid skill');
  assert(hasKey(characterKey(characterId)), 'character not found');

  const charData = getBytes(characterKey(characterId));
  const char = Character.deserialize(charData);

  const caller = Context.caller();
  assert(caller.toString() == char.owner.toString(), 'not character owner');

  // Check if skill already learned
  const learnedArray = char.learnedSkills.length > 0 ? char.learnedSkills.split(',') : [];
  for (let i = 0; i < learnedArray.length; i++) {
    if (parseInt(learnedArray[i]) == skillId) {
      assert(false, 'skill already learned');
    }
  }

  // Require minimum level based on skill
  const requiredLevel: u16 = skillId <= 3 ? 1 : (skillId <= 6 ? 5 : 10);
  assert(char.level >= requiredLevel, 'level too low for this skill');

  // Add to learned skills
  if (char.learnedSkills.length > 0) {
    char.learnedSkills = char.learnedSkills + ',' + skillId.toString();
  } else {
    char.learnedSkills = skillId.toString();
  }

  setBytes(characterKey(characterId), char.serialize());
  endNonReentrant();
  generateEvent('SkillLearned:' + characterId + ':' + skillId.toString());
}

// Equip a learned skill to a slot
export function game_equipSkill(args: StaticArray<u8>): void {
  whenNotPaused();
  nonReentrant();
  const ar = new Args(args);
  const characterId = ar.nextString().unwrap();
  const skillId = ar.nextU8().unwrap();
  const slot = ar.nextU8().unwrap(); // 1, 2, or 3

  assert(slot >= 1 && slot <= 3, 'invalid slot');
  assert(hasKey(characterKey(characterId)), 'character not found');

  const charData = getBytes(characterKey(characterId));
  const char = Character.deserialize(charData);

  const caller = Context.caller();
  assert(caller.toString() == char.owner.toString(), 'not character owner');

  // Check if skill is learned (or allow SKILL_NONE to unequip)
  if (skillId != SKILL_NONE) {
    const learnedArray = char.learnedSkills.length > 0 ? char.learnedSkills.split(',') : [];
    let found = false;
    for (let i = 0; i < learnedArray.length; i++) {
      if (parseInt(learnedArray[i]) == skillId) {
        found = true;
        break;
      }
    }
    assert(found, 'skill not learned');
  }

  // Equip to slot
  if (slot == 1) {
    char.skill1 = skillId;
  } else if (slot == 2) {
    char.skill2 = skillId;
  } else {
    char.skill3 = skillId;
  }

  setBytes(characterKey(characterId), char.serialize());
  endNonReentrant();
  generateEvent('SkillEquipped:' + characterId + ':slot' + slot.toString() + ':' + skillId.toString());
}

// Helper function to get skill cooldown based on skill type
function getSkillCooldown(skillId: u8): u8 {
  if (skillId == SKILL_POWER_STRIKE) return 3;
  if (skillId == SKILL_HEAL) return 4;
  if (skillId == SKILL_POISON_STRIKE) return 2;
  if (skillId == SKILL_STUN_STRIKE) return 5;
  if (skillId == SKILL_SHIELD_WALL) return 3;
  if (skillId == SKILL_RAGE_MODE) return 4;
  if (skillId == SKILL_CRITICAL_EYE) return 6;
  if (skillId == SKILL_DODGE_MASTER) return 5;
  if (skillId == SKILL_BURN_AURA) return 3;
  if (skillId == SKILL_COMBO_BREAKER) return 4;
  return 0;
}

// Helper function to get skill energy cost
function getSkillEnergyCost(skillId: u8): u8 {
  if (skillId == SKILL_POWER_STRIKE) return 30;
  if (skillId == SKILL_HEAL) return 40;
  if (skillId == SKILL_POISON_STRIKE) return 25;
  if (skillId == SKILL_STUN_STRIKE) return 50;
  if (skillId == SKILL_SHIELD_WALL) return 30;
  if (skillId == SKILL_RAGE_MODE) return 40;
  if (skillId == SKILL_CRITICAL_EYE) return 60;
  if (skillId == SKILL_DODGE_MASTER) return 50;
  if (skillId == SKILL_BURN_AURA) return 35;
  if (skillId == SKILL_COMBO_BREAKER) return 45;
  return 0;
}

// ============================================================================
// TREASURY MANAGEMENT
// ============================================================================

// Add funds to treasury (called by prediction contract)
export function game_addToTreasury(args: StaticArray<u8>): void {
  nonReentrant();
  const ar = new Args(args);
  const amount = ar.nextU64().unwrap();

  const currentBalance = getCounter(TREASURY_BALANCE_KEY);
  setCounter(TREASURY_BALANCE_KEY, currentBalance + amount);
  endNonReentrant();
  generateEvent('TreasuryDeposit:' + amount.toString());
}

// Withdraw from treasury (admin only)
export function game_withdrawTreasury(args: StaticArray<u8>): void {
  whenNotPaused();
  nonReentrant();
  onlyRole(ADMIN_ROLE);
  const ar = new Args(args);
  const amount = ar.nextU64().unwrap();
  const tokenAddr = new Address(ar.nextString().unwrap());
  const recipient = new Address(ar.nextString().unwrap());

  const currentBalance = getCounter(TREASURY_BALANCE_KEY);
  assert(currentBalance >= amount, 'insufficient treasury balance');

  setCounter(TREASURY_BALANCE_KEY, currentBalance - amount);
  const totalWithdrawn = getCounter(TREASURY_WITHDRAWN_KEY);
  setCounter(TREASURY_WITHDRAWN_KEY, totalWithdrawn + amount);

  // Transfer tokens
  const token = new IERC20(tokenAddr);
  token.transfer(recipient, amount);

  endNonReentrant();
  generateEvent('TreasuryWithdrawal:' + amount.toString());
}

// Get treasury balance
export function game_getTreasuryBalance(_: StaticArray<u8>): StaticArray<u8> {
  const result = new Args();
  result.add(getCounter(TREASURY_BALANCE_KEY));
  result.add(getCounter(TREASURY_WITHDRAWN_KEY));
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
  // Dynamic pool caps & risk management
  maxPoolSize: u64; // 0 = unlimited
  minBetSize: u64;
  maxBetSize: u64;

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
    this.maxPoolSize = 0; // unlimited by default
    this.minBetSize = 1; // 1 token minimum
    this.maxBetSize = 0; // unlimited by default
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
    a.add(this.maxPoolSize);
    a.add(this.minBetSize);
    a.add(this.maxBetSize);
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
    p.maxPoolSize = a.nextU64().unwrap();
    p.minBetSize = a.nextU64().unwrap();
    p.maxBetSize = a.nextU64().unwrap();
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

// Prop Bet Types
export const PROP_BATTLE_DURATION: u8 = 0; // Battle ends in under X turns
export const PROP_TOTAL_DAMAGE: u8 = 1; // Total damage dealt exceeds X
export const PROP_CRITICAL_HIT: u8 = 2; // Will a crit occur
export const PROP_WILDCARD_TRIGGER: u8 = 3; // Will wildcard trigger
export const PROP_STATUS_APPLIED: u8 = 4; // Will status effect be applied
export const PROP_COMBO_STREAK: u8 = 5; // Will 3+ combo be achieved

// Prop Bet Definition
export class PropBet {
  propId: string;
  battleId: string;
  propType: u8; // PROP_BATTLE_DURATION, etc.
  threshold: u64; // e.g., "under 10 turns" = 10
  description: string;
  yesPool: u128; // Total bets on "yes"
  noPool: u128; // Total bets on "no"
  isResolved: bool;
  outcome: bool; // true = yes won, false = no won
  createdAt: u64;

  constructor() {
    this.propId = '';
    this.battleId = '';
    this.propType = 0;
    this.threshold = 0;
    this.description = '';
    this.yesPool = u128.Zero;
    this.noPool = u128.Zero;
    this.isResolved = false;
    this.outcome = false;
    this.createdAt = 0;
  }

  serialize(): StaticArray<u8> {
    const a = new Args();
    a.add(this.propId);
    a.add(this.battleId);
    a.add(this.propType as u32);
    a.add(this.threshold);
    a.add(this.description);
    a.add(this.yesPool.toString());
    a.add(this.noPool.toString());
    a.add(this.isResolved);
    a.add(this.outcome);
    a.add(this.createdAt);
    return a.serialize();
  }

  static deserialize(data: StaticArray<u8>): PropBet {
    const a = new Args(data);
    const p = new PropBet();
    p.propId = a.nextString().unwrap();
    p.battleId = a.nextString().unwrap();
    p.propType = a.nextU32().unwrap() as u8;
    p.threshold = a.nextU64().unwrap();
    p.description = a.nextString().unwrap();
    p.yesPool = u128.fromString(a.nextString().unwrap());
    p.noPool = u128.fromString(a.nextString().unwrap());
    p.isResolved = a.nextBool().unwrap();
    p.outcome = a.nextBool().unwrap();
    p.createdAt = a.nextU64().unwrap();
    return p;
  }
}

// Individual Prop Bet Ticket
export class PropTicket {
  propId: string;
  bettor: Address;
  amount: u128;
  prediction: bool; // true = betting on "yes", false = betting on "no"
  isClaimed: bool;
  placedAt: u64;

  constructor() {
    this.propId = '';
    this.bettor = new Address('0');
    this.amount = u128.Zero;
    this.prediction = false;
    this.isClaimed = false;
    this.placedAt = 0;
  }

  serialize(): StaticArray<u8> {
    const a = new Args();
    a.add(this.propId);
    a.add(this.bettor.toString());
    a.add(this.amount.toString());
    a.add(this.prediction);
    a.add(this.isClaimed);
    a.add(this.placedAt);
    return a.serialize();
  }

  static deserialize(data: StaticArray<u8>): PropTicket {
    const a = new Args(data);
    const t = new PropTicket();
    t.propId = a.nextString().unwrap();
    t.bettor = new Address(a.nextString().unwrap());
    t.amount = u128.fromString(a.nextString().unwrap());
    t.prediction = a.nextBool().unwrap();
    t.isClaimed = a.nextBool().unwrap();
    t.placedAt = a.nextU64().unwrap();
    return t;
  }
}

// Helpers to read/write storage keys
function spoolKey(id: string): string { return SINGLE_POOL_PREFIX + id; }
function sbetKey(poolId: string, bettor: string): string { return SINGLE_BET_PREFIX + poolId + ':' + bettor; }
function mpoolKey(id: string): string { return MULTIPOOL_PREFIX + id; }
function betslipKey(id: string): string { return BETSLIP_PREFIX + id; }
function propBetKey(id: string): string { return 'propbet:' + id; }
function propTicketKey(propId: string, bettor: string): string { return 'propticket:' + propId + ':' + bettor; }

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

  // Validate bet size against pool caps
  assert(amount >= pool.minBetSize, 'bet below minimum');
  if (pool.maxBetSize > 0) {
    assert(amount <= pool.maxBetSize, 'bet above maximum');
  }

  // Check pool size cap
  const newTotal = pool.totalPool + u128.fromU64(amount);
  if (pool.maxPoolSize > 0) {
    assert(newTotal.toU64() <= pool.maxPoolSize, 'pool cap reached');
  }

  // transfer tokens from bettor to contract
  const caller = Context.caller();
  const token = new IERC20(pool.token);
  const allowance = token.allowance(caller, Context.callee());
  assert(allowance >= amount, 'allowance low');
  const bal = token.balanceOf(caller);
  assert(bal >= amount, 'insufficient token balance');

  token.transferFrom(caller, Context.callee(), amount);

  // update pool totals
  pool.totalPool = newTotal;
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

  // Track betting streaks
  const streakKeyBettor = streakKey(bettor);
  const currentStreak = getCounter(streakKeyBettor);

  // if losing bet, mark claimed and reset streak
  if (bet.outcome != pool.winningOutcome) {
    bet.isClaimed = true;
    setBytes(betKey, bet.serialize());
    incrementCounter(TOTAL_BETS_CLAIMED_KEY);

    // Reset losing streak
    setCounter(streakKeyBettor, 0);

    endNonReentrant();
    generateEvent('SingleBetClaimed:' + poolId + ':' + bettor.toString() + ':payout=0:streak=0');
    return;
  }

  // Winning bet - increment streak
  const newStreak = currentStreak + 1;
  setCounter(streakKeyBettor, newStreak);

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

  // Calculate streak bonus (5% per consecutive win, max 25% at 5 streak)
  let streakBonus: u64 = 0;
  if (newStreak >= 2) {
    const bonusPercent = newStreak < 5 ? (newStreak - 1) * 5 : 25;
    streakBonus = payoutU64 * bonusPercent / 100;
    // Add bonus to payout
    if (streakBonus > 0) {
      tokenContract.transfer(bettor, streakBonus);
    }
  }

  // Send house edge to treasury
  const houseAmountU64 = houseAmount.toU64();
  if (houseAmountU64 > 0) {
    setCounter(TREASURY_BALANCE_KEY, getCounter(TREASURY_BALANCE_KEY) + houseAmountU64);
  }

  endNonReentrant();
  generateEvent('SingleBetClaimed:' + poolId + ':' + bettor.toString() + ':payout=' + payoutU.toString() + ':streak=' + newStreak.toString() + ':bonus=' + streakBonus.toString());
}

// Authorize settler (admin)
export function prediction_setAuthorizedSettler(args: StaticArray<u8>): void {
  onlyRole(ADMIN_ROLE);
  const ar = new Args(args);
  const addr = ar.nextString().unwrap();
  setString(AUTH_SETTLER_PREFIX + addr, '1');
  generateEvent('SettlerAuthorized:' + addr);
}

// Get betting streak for an address
export function prediction_getBettingStreak(args: StaticArray<u8>): StaticArray<u8> {
  const ar = new Args(args);
  const addr = new Address(ar.nextString().unwrap());
  const result = new Args();
  result.add(getCounter(streakKey(addr)));
  return result.serialize();
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

//////////////////////////////
// Prop Bets Implementation
//////////////////////////////

// Create a prop bet for a battle
export function propbet_createProp(args: StaticArray<u8>): void {
  whenNotPaused();
  nonReentrant();
  onlyRole(ADMIN_ROLE); // Only admin can create prop bets

  const ar = new Args(args);
  const propId = ar.nextString().unwrap();
  const battleId = ar.nextString().unwrap();
  const propType = ar.nextU8().unwrap();
  const threshold = ar.nextU64().unwrap();
  const description = ar.nextString().unwrap();

  assert(!hasKey(propBetKey(propId)), 'prop exists');
  assert(hasKey(battleKey(battleId)), 'battle does not exist');

  const prop = new PropBet();
  prop.propId = propId;
  prop.battleId = battleId;
  prop.propType = propType;
  prop.threshold = threshold;
  prop.description = description;
  prop.yesPool = u128.Zero;
  prop.noPool = u128.Zero;
  prop.isResolved = false;
  prop.outcome = false;
  prop.createdAt = Context.timestamp();

  setBytes(propBetKey(propId), prop.serialize());
  endNonReentrant();
  generateEvent('PropBetCreated:' + propId + ':' + battleId);
}

// Place a bet on a prop (yes or no)
export function propbet_placeBet(args: StaticArray<u8>): void {
  whenNotPaused();
  nonReentrant();

  const ar = new Args(args);
  const propId = ar.nextString().unwrap();
  const amount = ar.nextU64().unwrap();
  const prediction = ar.nextBool().unwrap(); // true = yes, false = no
  const tokenAddr = new Address(ar.nextString().unwrap());

  assert(hasKey(propBetKey(propId)), 'prop does not exist');
  const propData = getBytes(propBetKey(propId));
  const prop = PropBet.deserialize(propData);

  assert(!prop.isResolved, 'prop already resolved');
  assert(amount > 0, 'amount must be positive');

  const caller = Context.caller();
  const ticketKey = propTicketKey(propId, caller.toString());
  assert(!hasKey(ticketKey), 'already bet on this prop');

  // Transfer tokens from bettor to contract
  const token = new IERC20(tokenAddr);
  token.transferFrom(caller, Context.callee(), amount);

  // Create ticket
  const ticket = new PropTicket();
  ticket.propId = propId;
  ticket.bettor = caller;
  ticket.amount = u128.fromU64(amount);
  ticket.prediction = prediction;
  ticket.isClaimed = false;
  ticket.placedAt = Context.timestamp();

  setBytes(ticketKey, ticket.serialize());

  // Update prop pools
  if (prediction) {
    prop.yesPool = prop.yesPool + u128.fromU64(amount);
  } else {
    prop.noPool = prop.noPool + u128.fromU64(amount);
  }

  setBytes(propBetKey(propId), prop.serialize());
  incrementCounter(TOTAL_BETS_PLACED_KEY);
  endNonReentrant();
  generateEvent('PropBetPlaced:' + propId + ':' + caller.toString() + ':' + amount.toString());
}

// Resolve a prop bet (admin/settler only)
export function propbet_resolveProp(args: StaticArray<u8>): void {
  whenNotPaused();
  nonReentrant();
  onlyRole(SETTLER_ROLE);

  const ar = new Args(args);
  const propId = ar.nextString().unwrap();
  const outcome = ar.nextBool().unwrap(); // true = yes won, false = no won

  assert(hasKey(propBetKey(propId)), 'prop does not exist');
  const propData = getBytes(propBetKey(propId));
  const prop = PropBet.deserialize(propData);

  assert(!prop.isResolved, 'already resolved');

  // Verify battle is finished
  assert(hasKey(battleKey(prop.battleId)), 'battle missing');
  const battleData = getBytes(battleKey(prop.battleId));
  const battle = Battle.deserialize(battleData);
  assert(battle.isFinished, 'battle not finished');

  prop.isResolved = true;
  prop.outcome = outcome;

  setBytes(propBetKey(propId), prop.serialize());
  endNonReentrant();
  generateEvent('PropBetResolved:' + propId + ':outcome=' + outcome.toString());
}

// Claim winnings from a prop bet
export function propbet_claimProp(args: StaticArray<u8>): void {
  whenNotPaused();
  nonReentrant();

  const ar = new Args(args);
  const propId = ar.nextString().unwrap();
  const tokenAddr = new Address(ar.nextString().unwrap());

  const caller = Context.caller();
  const ticketKey = propTicketKey(propId, caller.toString());

  assert(hasKey(ticketKey), 'no ticket found');
  const ticketData = getBytes(ticketKey);
  const ticket = PropTicket.deserialize(ticketData);

  assert(!ticket.isClaimed, 'already claimed');
  assert(hasKey(propBetKey(propId)), 'prop does not exist');

  const propData = getBytes(propBetKey(propId));
  const prop = PropBet.deserialize(propData);

  assert(prop.isResolved, 'prop not resolved');

  // Check if bettor won
  const isWinner = ticket.prediction == prop.outcome;
  if (!isWinner) {
    // Mark as claimed even if lost
    ticket.isClaimed = true;
    setBytes(ticketKey, ticket.serialize());
    incrementCounter(TOTAL_BETS_CLAIMED_KEY);
    endNonReentrant();
    generateEvent('PropBetClaimed:' + propId + ':' + caller.toString() + ':loss');
    return;
  }

  // Calculate payout (proportional to winning pool share)
  const winnerPool = prop.outcome ? prop.yesPool : prop.noPool;
  const loserPool = prop.outcome ? prop.noPool : prop.yesPool;
  const totalPool = prop.yesPool + prop.noPool;

  // Payout = ticket amount + (ticket share of loser pool)
  // Share = ticket.amount / winnerPool
  // Payout = ticket.amount + (loserPool * ticket.amount / winnerPool)
  let payoutU128 = ticket.amount;

  if (winnerPool > u128.Zero) {
    const loserShare = loserPool * ticket.amount / winnerPool;
    payoutU128 = payoutU128 + loserShare;
  }

  const payoutU64 = payoutU128.toU64();

  // Mark as claimed before transfer
  ticket.isClaimed = true;
  setBytes(ticketKey, ticket.serialize());

  // Transfer payout
  const token = new IERC20(tokenAddr);
  const bal = token.balanceOf(Context.callee());
  assert(bal >= payoutU64, 'contract insufficient funds');
  token.transfer(caller, payoutU64);

  incrementCounter(TOTAL_BETS_CLAIMED_KEY);
  endNonReentrant();
  generateEvent('PropBetClaimed:' + propId + ':' + caller.toString() + ':' + payoutU64.toString());
}

// View function to read prop bet state
export function propbet_readProp(args: StaticArray<u8>): StaticArray<u8> {
  const ar = new Args(args);
  const propId = ar.nextString().unwrap();
  if (!hasKey(propBetKey(propId))) return stringToBytes('null');
  return getBytes(propBetKey(propId));
}

// View function to read prop ticket state
export function propbet_readTicket(args: StaticArray<u8>): StaticArray<u8> {
  const ar = new Args(args);
  const propId = ar.nextString().unwrap();
  const bettor = ar.nextString().unwrap();
  const ticketKey = propTicketKey(propId, bettor);
  if (!hasKey(ticketKey)) return stringToBytes('null');
  return getBytes(ticketKey);
}

/*
  Notes & Next Steps:
  - The above provides core patterns and functions to implement the game and prediction/betting contracts on Massa AssemblyScript.
  - For production: replace simple_random with a secure VRF integration (Cadence equivalent on Massa if provided or oracle), implement treasury, refund/cancel flows,
    add robust multipool batch implementation, add exact serialization sizes, and write full unit tests and integration tests.
  - Also implement MP token support, careful gas and storage sizing, and off-chain indexer to assist in multipool accumulation and UI.
  - Prop bets add exciting gameplay by allowing bets on battle events like turn duration, critical hits, combos, wildcards, and status effects.
*/

/* End of artifact */