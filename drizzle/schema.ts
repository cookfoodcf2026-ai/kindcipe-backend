import {
  boolean,
  integer,
  pgEnum,
  pgTable,
  serial,
  text,
  timestamp,
  varchar,
} from "drizzle-orm/pg-core";

// ─── Enums ────────────────────────────────────────────────────────────────────
export const roleEnum = pgEnum("role", ["user", "admin"]);
export const familyRoleEnum = pgEnum("family_role", ["housewife", "helper", "member"]);
export const subscriptionStatusEnum = pgEnum("subscription_status", ["free", "trial", "active", "expired"]);
export const shoppingStatusEnum = pgEnum("shopping_status", ["pending", "active", "bought"]);
export const mealTypeEnum = pgEnum("meal_type", ["breakfast", "lunch", "dinner", "snack"]);
export const mealStatusEnum = pgEnum("meal_status", ["pending", "confirmed", "rejected"]);
export const sourceTypeEnum = pgEnum("source_type", ["instagram", "youtube", "xiaohongshu", "manual"]);
export const visibilityEnum = pgEnum("visibility", ["private", "pending_public", "public"]);
export const eventTypeEnum = pgEnum("event_type", ["view", "plan", "save", "cook"]);

// ─── Users ───────────────────────────────────────────────────────────────────
export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  openId: varchar("open_id", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  passwordHash: text("password_hash"),
  emailVerified: boolean("email_verified").default(false).notNull(),
  loginMethod: varchar("login_method", { length: 64 }),
  role: roleEnum("role").default("user").notNull(),
  familyId: integer("family_id"),
  familyRole: familyRoleEnum("family_role").default("member"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  lastSignedIn: timestamp("last_signed_in").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

// ─── Families ─────────────────────────────────────────────────────────────────
export const families = pgTable("families", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 128 }).notNull(),
  inviteCode: varchar("invite_code", { length: 16 }).notNull().unique(),
  ownerId: text("owner_id").notNull(),
  subscriptionStatus: subscriptionStatusEnum("subscription_status").default("trial").notNull(),
  trialStartedAt: timestamp("trial_started_at").defaultNow().notNull(),
  trialEndsAt: timestamp("trial_ends_at"),
  subscriptionExpiresAt: timestamp("subscription_expires_at"),
  appleTransactionId: varchar("apple_transaction_id", { length: 256 }),
  googleOrderId: varchar("google_order_id", { length: 256 }),
  maxMembers: integer("max_members").default(2).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type Family = typeof families.$inferSelect;
export type InsertFamily = typeof families.$inferInsert;

// ─── Family Members ───────────────────────────────────────────────────────────
export const familyMembers = pgTable("family_members", {
  id: serial("id").primaryKey(),
  familyId: integer("family_id").notNull(),
  userId: text("user_id").notNull(),
  familyRole: familyRoleEnum("family_role").default("member").notNull(),
  nickname: varchar("nickname", { length: 64 }),
  joinedAt: timestamp("joined_at").defaultNow().notNull(),
});

export type FamilyMember = typeof familyMembers.$inferSelect;
export type InsertFamilyMember = typeof familyMembers.$inferInsert;

// ─── Push Tokens ─────────────────────────────────────────────────────────────
export const pushTokens = pgTable("push_tokens", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  familyId: integer("family_id"),
  token: varchar("token", { length: 256 }).notNull(),
  platform: varchar("platform", { length: 16 }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type PushToken = typeof pushTokens.$inferSelect;
export type InsertPushToken = typeof pushTokens.$inferInsert;

// ─── Shopping Items ───────────────────────────────────────────────────────────
export const shoppingItems = pgTable("shopping_items", {
  id: serial("id").primaryKey(),
  familyId: integer("family_id").notNull(),
  name: varchar("name", { length: 128 }).notNull(),
  nameEn: varchar("name_en", { length: 128 }),
  category: varchar("category", { length: 64 }),
  quantity: varchar("quantity", { length: 64 }),
  unit: varchar("unit", { length: 32 }),
  estimatedPrice: integer("estimated_price"),
  lastPrice: integer("last_price"),
  status: shoppingStatusEnum("status").default("active").notNull(),
  proposedByUserId: integer("proposed_by_user_id"),
  proposedByName: varchar("proposed_by_name", { length: 64 }),
  fromRecipeId: varchar("from_recipe_id", { length: 64 }),
  fromRecipeName: varchar("from_recipe_name", { length: 128 }),
  plannedDate: varchar("planned_date", { length: 16 }),
  boughtByUserId: integer("bought_by_user_id"),
  boughtByName: varchar("bought_by_name", { length: 64 }),
  boughtAt: timestamp("bought_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type ShoppingItem = typeof shoppingItems.$inferSelect;
export type InsertShoppingItem = typeof shoppingItems.$inferInsert;

// ─── Meal Plans ───────────────────────────────────────────────────────────────
export const mealPlans = pgTable("meal_plans", {
  id: serial("id").primaryKey(),
  familyId: integer("family_id").notNull(),
  date: varchar("date", { length: 16 }).notNull(),
  mealType: mealTypeEnum("meal_type").default("dinner").notNull(),
  recipeId: varchar("recipe_id", { length: 64 }).notNull(),
  recipeName: varchar("recipe_name", { length: 128 }).notNull(),
  recipeImage: text("recipe_image"),
  status: mealStatusEnum("status").default("confirmed").notNull(),
  proposedByUserId: integer("proposed_by_user_id"),
  proposedByName: varchar("proposed_by_name", { length: 64 }),
  confirmedByUserId: integer("confirmed_by_user_id"),
  confirmedAt: timestamp("confirmed_at"),
  note: text("note"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type MealPlan = typeof mealPlans.$inferSelect;
export type InsertMealPlan = typeof mealPlans.$inferInsert;

// ─── Custom Recipes ───────────────────────────────────────────────────────────
export const customRecipes = pgTable("custom_recipes", {
  id: serial("id").primaryKey(),
  familyId: integer("family_id").notNull(),
  createdByUserId: text("created_by_user_id").notNull(),
  name: varchar("name", { length: 128 }).notNull(),
  description: text("description"),
  image: text("image"),
  thumbnailUrl: text("thumbnail_url"),
  cookTime: integer("cook_time"),
  servings: integer("servings"),
  difficulty: varchar("difficulty", { length: 16 }),
  recipeCategory: varchar("recipe_category", { length: 32 }),
  ingredients: text("ingredients"),
  steps: text("steps"),
  tags: text("tags"),
  sourceType: sourceTypeEnum("source_type").default("manual"),
  sourceUrl: text("source_url"),
  sourceUrlHash: varchar("source_url_hash", { length: 64 }),
  sourceAuthor: varchar("source_author", { length: 128 }),
  visibility: visibilityEnum("visibility").default("private").notNull(),
  approvedByUserId: text("approved_by_user_id"),
  approvedAt: timestamp("approved_at"),
  rejectionReason: text("rejection_reason"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type CustomRecipe = typeof customRecipes.$inferSelect;
export type InsertCustomRecipe = typeof customRecipes.$inferInsert;

// ─── Official Recipes ─────────────────────────────────────────────────────────
export const officialRecipes = pgTable("official_recipes", {
  id: serial("id").primaryKey(),
  importedByUserId: text("imported_by_user_id").notNull(),
  name: varchar("name", { length: 128 }).notNull(),
  description: text("description"),
  image: text("image"),
  thumbnailUrl: text("thumbnail_url"),
  cookTime: integer("cook_time"),
  servings: integer("servings"),
  difficulty: varchar("difficulty", { length: 16 }),
  recipeCategory: varchar("recipe_category", { length: 32 }),
  ingredients: text("ingredients"),
  steps: text("steps"),
  tags: text("tags"),
  sourceType: sourceTypeEnum("source_type").default("manual"),
  sourceUrl: text("source_url"),
  sourceUrlHash: varchar("source_url_hash", { length: 64 }),
  sourceAuthor: varchar("source_author", { length: 128 }),
  tips: text("tips"),
  isActive: boolean("is_active").default(true).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type OfficialRecipe = typeof officialRecipes.$inferSelect;
export type InsertOfficialRecipe = typeof officialRecipes.$inferInsert;

// ─── Recipe Events ────────────────────────────────────────────────────────────
export const recipeEvents = pgTable("recipe_events", {
  id: serial("id").primaryKey(),
  recipeId: varchar("recipe_id", { length: 64 }).notNull(),
  recipeName: varchar("recipe_name", { length: 128 }).notNull(),
  eventType: eventTypeEnum("event_type").notNull(),
  userId: integer("user_id"),
  familyId: integer("family_id"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type RecipeEvent = typeof recipeEvents.$inferSelect;
export type InsertRecipeEvent = typeof recipeEvents.$inferInsert;

// ─── Favorite Items ───────────────────────────────────────────────────────────
export const favoriteItems = pgTable("favorite_items", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  familyId: integer("family_id"),
  name: varchar("name", { length: 128 }).notNull(),
  category: varchar("category", { length: 64 }),
  unit: varchar("unit", { length: 32 }),
  sortOrder: integer("sort_order").default(0).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type FavoriteItem = typeof favoriteItems.$inferSelect;
export type InsertFavoriteItem = typeof favoriteItems.$inferInsert;

// ─── Purchase History ─────────────────────────────────────────────────────────
export const purchaseHistory = pgTable("purchase_history", {
  id: serial("id").primaryKey(),
  familyId: integer("family_id").notNull(),
  userId: integer("user_id").notNull(),
  userName: varchar("user_name", { length: 64 }),
  name: varchar("name", { length: 128 }).notNull(),
  category: varchar("category", { length: 64 }),
  unit: varchar("unit", { length: 32 }),
  quantity: varchar("quantity", { length: 64 }),
  shoppingItemId: integer("shopping_item_id"),
  actualPrice: integer("actual_price"),
  boughtAt: timestamp("bought_at").defaultNow().notNull(),
});

export type PurchaseHistory = typeof purchaseHistory.$inferSelect;
export type InsertPurchaseHistory = typeof purchaseHistory.$inferInsert;

// ─── Recipe Notes ─────────────────────────────────────────────────────────────
export const recipeNotes = pgTable("recipe_notes", {
  id: serial("id").primaryKey(),
  familyId: integer("family_id").notNull(),
  recipeId: varchar("recipe_id", { length: 64 }).notNull(),
  recipeName: varchar("recipe_name", { length: 128 }),
  userId: integer("user_id").notNull(),
  userName: varchar("user_name", { length: 64 }),
  content: text("content").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type RecipeNote = typeof recipeNotes.$inferSelect;
export type InsertRecipeNote = typeof recipeNotes.$inferInsert;

// ─── Weekly Menu ──────────────────────────────────────────────────────────────
export const weeklyMenu = pgTable("weekly_menu", {
  id: serial("id").primaryKey(),
  weekStart: varchar("week_start", { length: 16 }).notNull(),
  dayOfWeek: integer("day_of_week").notNull(),
  meatId: varchar("meat_id", { length: 64 }),
  meatName: varchar("meat_name", { length: 128 }),
  meatImage: text("meat_image"),
  meatCookTime: integer("meat_cook_time"),
  seafoodId: varchar("seafood_id", { length: 64 }),
  seafoodName: varchar("seafood_name", { length: 128 }),
  seafoodImage: text("seafood_image"),
  seafoodCookTime: integer("seafood_cook_time"),
  vegId: varchar("veg_id", { length: 64 }),
  vegName: varchar("veg_name", { length: 128 }),
  vegImage: text("veg_image"),
  vegCookTime: integer("veg_cook_time"),
  soupId: varchar("soup_id", { length: 64 }),
  soupName: varchar("soup_name", { length: 128 }),
  soupImage: text("soup_image"),
  soupCookTime: integer("soup_cook_time"),
  sponsorName: varchar("sponsor_name", { length: 128 }),
  sponsorUrl: text("sponsor_url"),
  sponsorLogoUrl: text("sponsor_logo_url"),
  setByUserId: integer("set_by_user_id").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type WeeklyMenu = typeof weeklyMenu.$inferSelect;
export type InsertWeeklyMenu = typeof weeklyMenu.$inferInsert;

// ─── Import Usage ─────────────────────────────────────────────────────────────
export const importUsage = pgTable("import_usage", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  yearMonth: varchar("year_month", { length: 7 }).notNull(),
  count: integer("count").default(0).notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type ImportUsage = typeof importUsage.$inferSelect;
export type InsertImportUsage = typeof importUsage.$inferInsert;

// ─── Pantry Items ─────────────────────────────────────────────────────────────
export const pantryItems = pgTable("pantry_items", {
  id: serial("id").primaryKey(),
  familyId: integer("family_id").notNull(),
  name: text("name").notNull(),
  category: text("category"),
  quantity: text("quantity"),
  unit: text("unit"),
  isLow: boolean("is_low").default(false).notNull(),
  inStock: boolean("in_stock").default(true).notNull(),
  expiryDate: varchar("expiry_date", { length: 16 }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
export type PantryItem = typeof pantryItems.$inferSelect;
export type InsertPantryItem = typeof pantryItems.$inferInsert;
