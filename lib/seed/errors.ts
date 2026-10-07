export class SeedError extends Error {
  constructor(public readonly publicMessage: string) {
    super(publicMessage);
    this.name = "SeedError";
  }
}
