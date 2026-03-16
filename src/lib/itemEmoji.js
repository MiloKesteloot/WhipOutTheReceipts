// Returns a food/item emoji for a given item name, or null if no match.
// Rules are checked in order — place more specific terms before broader ones.
const RULES = [
  // ── Fruits ──────────────────────────────────────────────────────────────
  [['strawberr'], '🍓'],
  [['blueberr'], '🫐'],
  [['raspberr', 'blackberr', 'cranberr'], '🍓'],
  [['watermelon'], '🍉'],
  [['pineapple'], '🍍'],
  [['mango'], '🥭'],
  [['peach', 'nectarine', 'apricot'], '🍑'],
  [['cherry', 'cherries'], '🍒'],
  [['grape', 'raisin'], '🍇'],
  [['orange', 'mandarin', 'clementine', 'tangerine'], '🍊'],
  [['lemon'], '🍋'],
  [['lime'], '🍋'],
  [['pear'], '🍐'],
  [['banana'], '🍌'],
  [['coconut'], '🥥'],
  [['avocado'], '🥑'],
  [['tomato', 'tomatoes'], '🍅'],
  [['apple', 'applesauce'], '🍎'],
  [['fig', 'date', 'plum', 'pomegranate', 'kiwi', 'papaya', 'guava', 'passion fruit'], '🍑'],
  [['melon', 'cantaloupe', 'honeydew'], '🍈'],

  // ── Vegetables ──────────────────────────────────────────────────────────
  [['sweet potato', 'yam'], '🍠'],
  [['potato', 'potatoes', 'tater', 'hash brown', 'hashbrown'], '🥔'],
  [['broccoli'], '🥦'],
  [['carrot'], '🥕'],
  [['corn', 'maize'], '🌽'],
  [['cucumber'], '🥒'],
  [['eggplant', 'aubergine'], '🍆'],
  [['garlic'], '🧄'],
  [['onion', 'shallot', 'scallion', 'leek', 'chive'], '🧅'],
  [['bell pepper', 'capsicum'], '🫑'],
  [['pepper', 'jalapeño', 'jalapeno', 'habanero', 'chili', 'chile'], '🌶️'],
  [['spinach', 'kale', 'arugula', 'chard', 'collard', 'romaine', 'cabbage', 'bok choy', 'lettuce', 'mixed greens', 'salad greens'], '🥬'],
  [['mushroom'], '🍄'],
  [['asparagus', 'artichoke', 'zucchini', 'squash', 'celery', 'pea ', 'peas', 'bean ', 'beans', 'lentil', 'chickpea', 'edamame', 'beet', 'radish', 'turnip', 'parsnip', 'fennel'], '🥦'],
  [['cauliflower'], '🥦'],

  // ── Proteins ────────────────────────────────────────────────────────────
  [['shrimp', 'prawn'], '🍤'],
  [['salmon', 'tuna', 'tilapia', 'cod', 'halibut', 'mahi', 'trout', 'catfish', 'sardine', 'anchov'], '🐟'],
  [['lobster', 'crab', 'clam', 'oyster', 'scallop', 'mussel', 'squid', 'calamari'], '🦞'],
  [['fish', 'seafood', 'sushi'], '🐟'],
  [['bacon'], '🥓'],
  [['sausage', 'bratwurst', 'chorizo', 'salami', 'pepperoni', 'prosciutto', 'ham', 'hot dog', 'hotdog'], '🌭'],
  [['chicken', 'poultry', 'rotisserie'], '🍗'],
  [['turkey'], '🍗'],
  [['steak', 'ribeye', 'sirloin', 'filet', 'brisket', 'ground beef', 'ground turkey', 'lamb', 'veal', 'venison', 'pork loin', 'pork chop', 'pork rib'], '🥩'],
  [['beef', 'meat'], '🥩'],
  [['egg', 'eggs'], '🥚'],
  [['tofu', 'tempeh', 'seitan'], '🫘'],

  // ── Dairy ────────────────────────────────────────────────────────────────
  [['ice cream', 'gelato', 'sorbet', 'frozen yogurt', 'popsicle'], '🍦'],
  [['butter', 'ghee', 'margarine'], '🧈'],
  [['cheese', 'cheddar', 'mozzarella', 'parmesan', 'brie', 'gouda', 'feta', 'ricotta', 'cottage cheese', 'cream cheese', 'provolone'], '🧀'],
  [['yogurt', 'kefir'], '🥛'],
  [['milk', 'oat milk', 'almond milk', 'soy milk', 'cream', 'half & half', 'half and half', 'whipping cream', 'heavy cream'], '🥛'],

  // ── Bread & Grains ───────────────────────────────────────────────────────
  [['bagel'], '🥯'],
  [['croissant'], '🥐'],
  [['waffle'], '🧇'],
  [['pancake', 'hotcake'], '🥞'],
  [['tortilla', 'pita', 'flatbread', 'naan', 'lavash'], '🫓'],
  [['bread', 'baguette', 'sourdough', 'brioche', 'ciabatta', 'focaccia', 'roll ', 'rolls', 'bun ', 'buns'], '🍞'],
  [['pasta', 'spaghetti', 'penne', 'rigatoni', 'fettuccine', 'linguine', 'farfalle', 'orzo', 'macaroni', 'lasagna', 'noodle', 'ramen noodle'], '🍝'],
  [['rice', 'quinoa', 'couscous', 'barley', 'farro', 'bulgur'], '🍚'],
  [['oat', 'granola', 'muesli', 'cereal'], '🥣'],
  [['flour', 'cornmeal', 'cornstarch', 'breadcrumb', 'wheat'], '🌾'],

  // ── Prepared / Restaurant ────────────────────────────────────────────────
  [['pizza'], '🍕'],
  [['burger', 'hamburger', 'cheeseburger'], '🍔'],
  [['taco', 'tacos'], '🌮'],
  [['burrito', 'quesadilla', 'enchilada', 'tamale', 'fajita'], '🌯'],
  [['sandwich', 'sub ', 'hoagie', 'panini', 'wrap '], '🥪'],
  [['sushi', 'maki', 'nigiri', 'tempura'], '🍱'],
  [['ramen', 'pho', 'udon', 'soba'], '🍜'],
  [['soup', 'stew', 'chili', 'chowder', 'bisque', 'broth', 'stock'], '🍲'],
  [['salad'], '🥥'],
  [['hot sauce', 'sriracha', 'tabasco', 'ketchup', 'marinara', 'tomato sauce', 'pasta sauce', 'salsa', 'pesto'], '🫙'],
  [['hummus', 'tahini', 'guacamole', 'dip'], '🫙'],
  [['mustard', 'mayo', 'mayonnaise', 'ranch', 'vinaigrette', 'dressing', 'bbq sauce', 'teriyaki', 'soy sauce', 'worcestershire', 'hot sauce'], '🫙'],

  // ── Snacks ───────────────────────────────────────────────────────────────
  [['popcorn'], '🍿'],
  [['pretzel'], '🥨'],
  [['chip', 'crisp', 'doritos', 'cheeto', 'pringle', 'fritos', 'tortilla chip', 'corn chip'], '🥨'],
  [['cracker', 'graham cracker', 'rice cake'], '🫙'],
  [['trail mix', 'mixed nut', 'almond', 'cashew', 'walnut', 'pecan', 'pistachio', 'hazelnut', 'macadamia', 'peanut butter', 'peanut'], '🥜'],
  [['nut', 'nuts', 'seed ', 'seeds', 'sunflower seed', 'pumpkin seed', 'chia seed', 'flaxseed'], '🥜'],

  // ── Sweets & Desserts ────────────────────────────────────────────────────
  [['chocolate', 'cocoa', 'nutella'], '🍫'],
  [['candy', 'gummy', 'lollipop', 'jellybean', 'skittle', 'starburst', 'm&m', 'haribo'], '🍬'],
  [['cookie', 'biscuit', 'brownie', 'bar '], '🍪'],
  [['cake', 'cupcake', 'muffin', 'donut', 'doughnut', 'pastry', 'danish', 'scone', 'eclair'], '🎂'],
  [['pie', 'cobbler', 'tart ', 'turnover'], '🥧'],
  [['pudding', 'custard', 'mousse', 'jello', 'gelatin'], '🍮'],
  [['syrup', 'maple syrup', 'agave', 'molasses'], '🍯'],
  [['honey'], '🍯'],
  [['jam', 'jelly', 'preserve', 'marmalade', 'spread'], '🫙'],

  // ── Beverages ────────────────────────────────────────────────────────────
  [['coffee', 'espresso', 'latte', 'cold brew', 'cappuccino', 'americano', 'k-cup', 'kcup'], '☕'],
  [['tea', 'matcha', 'chai', 'herbal tea', 'green tea', 'black tea', 'iced tea'], '🍵'],
  [['beer', 'lager', 'ale', 'stout', 'ipa ', 'cider'], '🍺'],
  [['wine', 'champagne', 'prosecco', 'rosé', 'rose '], '🍷'],
  [['cocktail', 'spirits', 'whiskey', 'whisky', 'vodka', 'rum', 'gin ', 'tequila', 'bourbon', 'brandy', 'liqueur'], '🍹'],
  [['juice', 'lemonade', 'limeade', 'smoothie', 'kombucha'], '🧃'],
  [['soda', 'cola', 'pepsi', 'coke', 'sprite', 'gatorade', 'powerade', 'energy drink', 'red bull', 'monster'], '🥤'],
  [['sparkling water', 'sparkling', 'la croix', 'bubbly', 'seltz', 'tonic', 'club soda'], '🥤'],
  [['water', 'h2o'], '💧'],
  [['protein shake', 'protein powder', 'whey'], '🥛'],

  // ── Pantry ───────────────────────────────────────────────────────────────
  [['oil', 'olive oil', 'coconut oil', 'vegetable oil', 'canola oil', 'cooking spray'], '🫙'],
  [['vinegar', 'balsamic'], '🫙'],
  [['salt'], '🧂'],
  [['sugar', 'brown sugar', 'powdered sugar', 'stevia', 'splenda', 'sweetener'], '🍬'],
  [['spice', 'seasoning', 'herb ', 'herbs', 'oregano', 'basil', 'thyme', 'rosemary', 'cumin', 'paprika', 'cinnamon', 'turmeric', 'ginger', 'bay leaf', 'black pepper', 'cayenne', 'chili powder', 'allspice', 'nutmeg', 'clove'], '🧂'],
  [['canned', 'can of', 'soup can'], '🥫'],
  [['bean', 'lentil', 'chickpea', 'kidney bean', 'black bean', 'pinto bean', 'cannellini'], '🫘'],
  [['broth', 'stock'], '🫙'],

  // ── Frozen ───────────────────────────────────────────────────────────────
  [['frozen', 'frost'], '🧊'],

  // ── Household ────────────────────────────────────────────────────────────
  [['toilet paper', 'tp ', 'tissue', 'paper towel', 'napkin', 'kleenex'], '🧻'],
  [['detergent', 'laundry', 'dish soap', 'dishwasher', 'fabric softener', 'dryer sheet'], '🧴'],
  [['shampoo', 'conditioner', 'body wash', 'soap', 'face wash', 'lotion', 'sunscreen', 'deodorant', 'toothpaste', 'mouthwash', 'floss'], '🧴'],
  [['trash bag', 'garbage bag', 'zip lock', 'ziploc', 'plastic bag', 'aluminum foil', 'plastic wrap', 'saran wrap', 'parchment', 'wax paper'], '🗑️'],
  [['sponge', 'scrub', 'cleaning', 'disinfect', 'bleach', 'windex', 'lysol', 'febreze', 'air freshener'], '🧽'],
  [['candle', 'diffuser'], '🕯️'],
  [['battery', 'batteries', 'lightbulb', 'light bulb'], '🔋'],
]

export function getItemEmoji(name) {
  if (!name) return null
  const lower = name.toLowerCase()
  for (const [keywords, emoji] of RULES) {
    if (keywords.some(k => lower.includes(k))) return emoji
  }
  return null
}
