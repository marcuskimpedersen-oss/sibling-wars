export class ResourceManager {
  private gold: number = 500;
  private juice: number = 500;

  infiniteResources = false;

  /** Called whenever gold is added (not spent). Used for income rate tracking. */
  onGoldAdded: ((amount: number) => void) | null = null;
  /** Called whenever gold is spent. Used for Battle Report tracking. */
  onGoldSpent: ((amount: number) => void) | null = null;

  // Gold
  addGold(amount: number): void { this.gold += amount; this.onGoldAdded?.(amount); }
  spendGold(amount: number): boolean {
    if (this.infiniteResources) return true;
    if (this.gold < amount) return false;
    this.gold -= amount;
    this.onGoldSpent?.(amount);
    return true;
  }
  getGold(): number { return this.infiniteResources ? 999999 : this.gold; }

  // Juice (from underground geysers)
  addJuice(amount: number): void { this.juice += amount; }
  spendJuice(amount: number): boolean {
    if (this.infiniteResources) return true;
    if (this.juice < amount) return false;
    this.juice -= amount;
    return true;
  }
  getJuice(): number { return this.infiniteResources ? 999999 : this.juice; }

  /** Spend both resources atomically. Returns false if either is insufficient. */
  spend(gold: number, juice = 0): boolean {
    if (this.infiniteResources) return true;
    if (this.gold < gold || this.juice < juice) return false;
    this.gold  -= gold;
    this.juice -= juice;
    if (gold > 0) this.onGoldSpent?.(gold);
    return true;
  }
}
