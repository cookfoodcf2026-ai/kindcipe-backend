import { resolve } from "node:path";
import { FakeRepository } from "./repository";

export function loadSeedCatalog(): FakeRepository {
  return FakeRepository.fromFile(resolve(process.cwd(), "server/fixtures/aiChef/catalog.json"));
}
