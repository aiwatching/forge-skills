// Minimal YAML parser — handles the simple sources.yaml format
// Avoids adding a dependency for a trivial config file

export function parse(text) {
  const result = {};
  let currentKey = null;
  let currentList = null;

  for (const rawLine of text.split("\n")) {
    const line = rawLine.replace(/#.*$/, "").trimEnd(); // strip comments
    if (!line.trim()) continue;

    // Top-level key with colon
    const topMatch = line.match(/^(\w+):(.*)$/);
    if (topMatch) {
      currentKey = topMatch[1];
      const value = topMatch[2].trim();
      if (value) {
        result[currentKey] = value;
        currentList = null;
      } else {
        result[currentKey] = [];
        currentList = result[currentKey];
      }
      continue;
    }

    // List item: "  - something"
    const listMatch = line.match(/^\s+-\s+(.+)$/);
    if (listMatch && currentList) {
      const val = listMatch[1].trim();
      // Check if it's a key:value pair inside a list item
      const kvMatch = val.match(/^(\w+):\s*(.+)$/);
      if (kvMatch) {
        // First kv in a new list object
        const obj = { [kvMatch[1]]: tryParse(kvMatch[2]) };
        currentList.push(obj);
      } else {
        currentList.push(tryParse(val));
      }
      continue;
    }

    // Continuation key:value under a list item: "    key: value"
    const contMatch = line.match(/^\s{4,}(\w+):\s*(.+)$/);
    if (contMatch && currentList && currentList.length > 0) {
      const last = currentList[currentList.length - 1];
      if (typeof last === "object") {
        last[contMatch[1]] = tryParse(contMatch[2]);
      }
    }
  }

  return result;
}

function tryParse(val) {
  if (val === "true") return true;
  if (val === "false") return false;
  const num = Number(val);
  if (!isNaN(num) && val.trim() !== "") return num;
  return val.replace(/^["']|["']$/g, "");
}
