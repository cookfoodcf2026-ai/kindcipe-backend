import { pgTable, unique, pgPolicy, uuid, text, boolean, timestamp, serial, integer, varchar, jsonb, pgEnum } from "drizzle-orm/pg-core"
import { sql } from "drizzle-orm"

export const eventType = pgEnum("event_type", ['view', 'plan', 'save', 'cook'])
export const familyRole = pgEnum("family_role", ['owner', 'admin', 'helper', 'member'])
export const mealStatus = pgEnum("meal_status", ['pending', 'confirmed', 'rejected'])
export const mealType = pgEnum("meal_type", ['breakfast', 'lunch', 'dinner', 'snack'])
export const role = pgEnum("role", ['user', 'admin'])
export const shoppingStatus = pgEnum("shopping_status", ['pending', 'active', 'bought'])
export const sourceType = pgEnum("source_type", ['instagram', 'youtube', 'xiaohongshu', 'threads', 'tiktok', 'manual'])
export const subscriptionStatus = pgEnum("subscription_status", ['free', 'trial', 'active', 'expired'])
export const visibility = pgEnum("visibility", ['private', 'pending_public', 'public'])


export const users = pgTable("users", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	openId: text("open_id").notNull(),
	name: text(),
	email: text(),
	passwordHash: text("password_hash"),
	emailVerified: boolean("email_verified").default(false),
	loginMethod: text("login_method").default('email'),
	role: text().default('user'),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow(),
	lastSignedIn: timestamp("last_signed_in", { withTimezone: true, mode: 'string' }),
}, (table) => [
	unique("users_open_id_unique").on(table.openId),
	pgPolicy("Allow public select", { as: "permissive", for: "select", to: ["public"], using: sql`true` }),
	pgPolicy("Allow public insert", { as: "permissive", for: "insert", to: ["public"] }),
]);

export const favoriteItems = pgTable("favorite_items", {
	id: serial().primaryKey().notNull(),
	userId: text("user_id").notNull(),
	familyId: integer("family_id"),
	name: varchar({ length: 128 }).notNull(),
	category: varchar({ length: 64 }),
	unit: varchar({ length: 32 }),
	sortOrder: integer("sort_order").default(0).notNull(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
});

export const pantryItems = pgTable("pantry_items", {
	id: serial().primaryKey().notNull(),
	familyId: integer("family_id").notNull(),
	name: text().notNull(),
	category: text(),
	quantity: text(),
	unit: text(),
	isLow: boolean("is_low").default(false).notNull(),
	inStock: boolean("in_stock").default(true).notNull(),
	expiryDate: varchar("expiry_date", { length: 16 }),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow().notNull(),
});

export const commonIngredients = pgTable("common_ingredients", {
	id: serial().primaryKey().notNull(),
	categoryKey: varchar("category_key", { length: 32 }).notNull(),
	defaultUnitKey: varchar("default_unit_key", { length: 32 }),
	nameYue: varchar("name_yue", { length: 128 }).notNull(),
	nameZh: varchar("name_zh", { length: 128 }).notNull(),
	nameEn: varchar("name_en", { length: 128 }).notNull(),
	nameFil: varchar("name_fil", { length: 128 }),
	nameId: varchar("name_id", { length: 128 }),
	isActive: boolean("is_active").default(true).notNull(),
	sortOrder: integer("sort_order").default(0).notNull(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	unique("common_ingredients_name_yue_unique").on(table.nameYue),
]);

export const customRecipes = pgTable("custom_recipes", {
	id: serial().primaryKey().notNull(),
	familyId: integer("family_id").notNull(),
	createdByUserId: text("created_by_user_id").notNull(),
	name: varchar({ length: 128 }).notNull(),
	description: text(),
	image: text(),
	thumbnailUrl: text("thumbnail_url"),
	cookTime: integer("cook_time"),
	servings: integer(),
	difficulty: varchar({ length: 16 }),
	recipeCategory: varchar("recipe_category", { length: 32 }),
	ingredients: text(),
	steps: text(),
	tags: text(),
	sourceType: sourceType("source_type").default('manual'),
	sourceUrl: text("source_url"),
	sourceUrlHash: varchar("source_url_hash", { length: 64 }),
	sourceAuthor: varchar("source_author", { length: 128 }),
	visibility: visibility().default('private').notNull(),
	approvedByUserId: text("approved_by_user_id"),
	approvedAt: timestamp("approved_at", { mode: 'string' }),
	rejectionReason: text("rejection_reason"),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow().notNull(),
	popularity: integer().default(50).notNull(),
});

export const importUsage = pgTable("import_usage", {
	id: serial().primaryKey().notNull(),
	userId: text("user_id").notNull(),
	yearMonth: varchar("year_month", { length: 7 }).notNull(),
	count: integer().default(0).notNull(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow().notNull(),
});

export const officialRecipes = pgTable("official_recipes", {
	id: serial().primaryKey().notNull(),
	importedByUserId: text("imported_by_user_id").notNull(),
	name: varchar({ length: 128 }).notNull(),
	description: text(),
	image: text(),
	thumbnailUrl: text("thumbnail_url"),
	cookTime: integer("cook_time"),
	servings: integer(),
	difficulty: varchar({ length: 16 }),
	recipeCategory: varchar("recipe_category", { length: 32 }),
	ingredients: text(),
	steps: text(),
	tags: text(),
	sourceType: sourceType("source_type").default('manual'),
	sourceUrl: text("source_url"),
	sourceUrlHash: varchar("source_url_hash", { length: 64 }),
	sourceAuthor: varchar("source_author", { length: 128 }),
	tips: text(),
	isActive: boolean("is_active").default(true).notNull(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow().notNull(),
	popularity: integer().default(50).notNull(),
});

export const mealPlans = pgTable("meal_plans", {
	id: serial().primaryKey().notNull(),
	familyId: integer("family_id").notNull(),
	date: varchar({ length: 16 }).notNull(),
	mealType: mealType("meal_type").default('dinner').notNull(),
	recipeId: varchar("recipe_id", { length: 64 }).notNull(),
	recipeName: varchar("recipe_name", { length: 128 }).notNull(),
	recipeImage: text("recipe_image"),
	status: mealStatus().default('confirmed').notNull(),
	proposedByUserId: text("proposed_by_user_id"),
	proposedByName: varchar("proposed_by_name", { length: 64 }),
	confirmedByUserId: text("confirmed_by_user_id"),
	confirmedAt: timestamp("confirmed_at", { mode: 'string' }),
	note: text(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow().notNull(),
});

export const families = pgTable("families", {
	id: serial().primaryKey().notNull(),
	name: varchar({ length: 128 }).notNull(),
	inviteCode: varchar("invite_code", { length: 16 }).notNull(),
	ownerId: text("owner_id").notNull(),
	subscriptionStatus: subscriptionStatus("subscription_status").default('trial').notNull(),
	trialStartedAt: timestamp("trial_started_at", { mode: 'string' }).defaultNow().notNull(),
	trialEndsAt: timestamp("trial_ends_at", { mode: 'string' }),
	subscriptionExpiresAt: timestamp("subscription_expires_at", { mode: 'string' }),
	appleTransactionId: varchar("apple_transaction_id", { length: 256 }),
	googleOrderId: varchar("google_order_id", { length: 256 }),
	maxMembers: integer("max_members").default(2).notNull(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow().notNull(),
	settings: jsonb().default({"approvalRequired":true}).notNull(),
}, (table) => [
	unique("families_invite_code_unique").on(table.inviteCode),
]);

export const purchaseHistory = pgTable("purchase_history", {
	id: serial().primaryKey().notNull(),
	familyId: integer("family_id").notNull(),
	userId: text("user_id").notNull(),
	userName: varchar("user_name", { length: 64 }),
	name: varchar({ length: 128 }).notNull(),
	category: varchar({ length: 64 }),
	unit: varchar({ length: 32 }),
	quantity: varchar({ length: 64 }),
	shoppingItemId: integer("shopping_item_id"),
	actualPrice: integer("actual_price"),
	boughtAt: timestamp("bought_at", { mode: 'string' }).defaultNow().notNull(),
});

export const pushTokens = pgTable("push_tokens", {
	id: serial().primaryKey().notNull(),
	userId: text("user_id").notNull(),
	familyId: integer("family_id"),
	token: varchar({ length: 256 }).notNull(),
	platform: varchar({ length: 16 }),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow().notNull(),
});

export const recipeEvents = pgTable("recipe_events", {
	id: serial().primaryKey().notNull(),
	recipeId: varchar("recipe_id", { length: 64 }).notNull(),
	recipeName: varchar("recipe_name", { length: 128 }).notNull(),
	eventType: eventType("event_type").notNull(),
	userId: text("user_id"),
	familyId: integer("family_id"),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
});

export const familyMembers = pgTable("family_members", {
	id: serial().primaryKey().notNull(),
	familyId: integer("family_id").notNull(),
	userId: text("user_id").notNull(),
	familyRole: familyRole("family_role").default('member').notNull(),
	nickname: varchar({ length: 64 }),
	joinedAt: timestamp("joined_at", { mode: 'string' }).defaultNow().notNull(),
	isDefault: boolean("is_default").default(false).notNull(),
});

export const recipeNotes = pgTable("recipe_notes", {
	id: serial().primaryKey().notNull(),
	familyId: integer("family_id").notNull(),
	recipeId: varchar("recipe_id", { length: 64 }).notNull(),
	recipeName: varchar("recipe_name", { length: 128 }),
	userId: text("user_id").notNull(),
	userName: varchar("user_name", { length: 64 }),
	content: text().notNull(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow().notNull(),
});

export const shoppingItems = pgTable("shopping_items", {
	id: serial().primaryKey().notNull(),
	familyId: integer("family_id").notNull(),
	name: varchar({ length: 128 }).notNull(),
	nameEn: varchar("name_en", { length: 128 }),
	category: varchar({ length: 64 }),
	quantity: varchar({ length: 64 }),
	unit: varchar({ length: 32 }),
	estimatedPrice: integer("estimated_price"),
	lastPrice: integer("last_price"),
	status: shoppingStatus().default('active').notNull(),
	proposedByUserId: text("proposed_by_user_id"),
	proposedByName: varchar("proposed_by_name", { length: 64 }),
	fromRecipeId: varchar("from_recipe_id", { length: 64 }),
	fromRecipeName: varchar("from_recipe_name", { length: 128 }),
	plannedDate: varchar("planned_date", { length: 16 }),
	boughtByUserId: text("bought_by_user_id"),
	boughtByName: varchar("bought_by_name", { length: 64 }),
	boughtAt: timestamp("bought_at", { mode: 'string' }),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow().notNull(),
	commonIngredientId: integer("common_ingredient_id"),
});

export const weeklyMenu = pgTable("weekly_menu", {
	id: serial().primaryKey().notNull(),
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
	setByUserId: text("set_by_user_id").notNull(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow().notNull(),
	familyId: integer("family_id").notNull(),
});
