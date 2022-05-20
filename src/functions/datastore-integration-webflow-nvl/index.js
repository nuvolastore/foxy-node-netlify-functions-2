const FoxyWebhook = require("../../foxy/FoxyWebhook.js");
const Webflow = require("webflow-api");
const { config } = require("../../../config.js");
const webFlowCollectionID = config.datastore.provider.webflow.collection;

exports.handler = async (requestEvent) => {
  // Validation
  if (!validation.configuration.validate()) {
    return validation.configuration.response();
  }
  if (!validation.input.validate(requestEvent)) {
    return validation.input.response();
  }
  console.log("Passed validation");
  const items = extractItems(requestEvent.body);
  const patchedItems = [];
  const cache = createCache();
  try {
    //Go through the array of foxy items
    await Promise.all(
      items.map(async (item) => {
        const foxyItemInfo = {
          code: item.code,
          quantity: item.quantity,
          size: getOption(item, "Taglia"),
        };
        console.log("Going through this item, ", foxyItemInfo);

        // Fetch items and patch the size according to the quantity
        await fetchItem(cache, foxyItemInfo).then(async (wfItem) => {
          console.log("I'm the fetched Item from webflow: ", wfItem);
          const patchedSizeItem = updateInventorySizeField(
            foxyItemInfo,
            wfItem
          );
          const patchedItem = await patchItem(patchedSizeItem);
          patchedItems.push(patchedItem);
        });
      })
    );
    console.log("Patched Items: ", patchedItems);
    return {
      body: JSON.stringify({ ok: true, patchedItems: patchedItems }),
      statusCode: 200,
    };
  } catch (error) {
    console.error(error);
    return {
      body: JSON.stringify({
        details: "An internal error has occurred",
        ok: false,
      }),
      statusCode: 500,
    };
  }
};

// ------------Helper functions-------------

/**
 * Retrieve the Webflow Token
 *
 * @returns {string} the FOXY_WEBFLOW_TOKEN
 */
function getToken() {
  return config.datastore.provider.webflow.token;
}

/**
 * Retrieve an instance of the Webflow API Client
 *
 * @returns {Webflow} the webflow api object
 */
function getWebflow() {
  let webflowApi;
  if (!webflowApi) {
    webflowApi = new Webflow({ token: getToken() });
  }
  return webflowApi;
}

/**
 * Patches fields of a product in the Webflow Product CMS Collection, returns the patched items in an object.
 *
 * @param {object} item item info to update it's size
 * @returns {object} patched item with updated fields
 */
async function patchItem(item) {
  const collectionId = webFlowCollectionID;
  const webflow = getWebflow();
  return await webflow.patchItem(
    {
      collectionId: collectionId,
      fields: {
        "size-quantity": item["size-quantity"],
      },
      itemId: item._id,
    },
    { live: true }
  );
}

/**
 * Parses the size's filed string and updates it according to the foxyItem
 * returns the updated Item with the resulting size inventory
 *
 * @param {object} foxyItem with info on quantity and size
 * @param {object} webFlowItem the item as it's in the CMS collection that needs to be updated
 * @returns {object} item with updated size field
 */
function updateInventorySizeField(foxyItem, webFlowItem) {
  const { quantity, size } = foxyItem;
  let wfSizeObject = webFlowItem["size-quantity"]
    .split(",")
    .map((size) => size.split(":"));
  wfSizeObject = Object.fromEntries(wfSizeObject);

  if (wfSizeObject[size.value] !== "0")
    wfSizeObject[size.value] =
      Number(wfSizeObject[size.value]) - Number(quantity);

  webFlowItem["size-quantity"] = objToString(wfSizeObject);
  console.log("I'm the webflowItem Patched to send: ", webFlowItem);
  return webFlowItem;
}

/**
 * Converts and object with sizes and quantities, into a string
 *
 * @param {object} obj Sizes object
 * @returns {string} string of updated size values
 *
 * */
function objToString(obj) {
  return Object.entries(obj).reduce((str, [p, val], index, array) => {
    if (index === array.length - 1) return `${str}${p}:${val}`;

    return `${str}${p}:${val},`;
  }, "");
}

/**
 * Returns a recursive promise that fetches items from the collection until it
 * finds the item. Resolves the found item.
 *
 * Note: this method will take time linear on the size of the collection.
 * For large collections it will probably timeout.
 *
 * Webflow does not provide a documented feature for retrieving filtered
 * results based on arbitrary field.
 *
 * @param {object} cache object
 * @param {object} foxyItem received from foxycart
 * @param {number} offset number of items to skip
 * @returns {Promise<{object}>} a promise for the item from Webflow
 */
function fetchItem(cache, foxyItem, offset = 0) {
  const WEBFLOW_LIMIT = 100;

  if (offset > 500) {
    console.log("   ... giving up.");
    return Promise.reject(new Error("Item not found"));
  }
  if (offset) {
    console.log("   ... couldn't find the item in first", offset, "items.");
  }
  const collectionId = webFlowCollectionID;
  const webflow = getWebflow();
  const found = cache.findItem(collectionId, foxyItem);
  if (found) {
    return Promise.resolve(found);
  }
  return new Promise((resolve, reject) => {
    webflow
      .items(
        { collectionId },
        {
          limit: WEBFLOW_LIMIT,
          offset,
          sort: ["code", "ASC"],
        }
      )
      .then((collection) => {
        cache.addItems(collectionId, collection.items);
        let code_exists = null;
        const match = collection.items.find((e) => {
          const wfItemCode = iGet(e, "code");
          if (wfItemCode === undefined) {
            if (code_exists === null) {
              code_exists = false;
            }
            return false;
          }
          code_exists = true;
          return (
            foxyItem.code && wfItemCode.toString() === foxyItem.code.toString()
          );
        });
        if (code_exists === false) {
          reject(
            new Error(`Could not find the code field code in Webflow.
              this field must exist and not be empty for all items in the collection.`)
          );
        } else {
          if (match) {
            resolve(match);
          } else if (collection.total > collection.offset + collection.count) {
            fetchItem(
              cache,
              foxyItem,
              (offset / WEBFLOW_LIMIT + 1) * WEBFLOW_LIMIT
            )
              .then((i) => resolve(i))
              .catch((e) => {
                reject(e);
              });
          } else {
            reject(new Error("Item not found"));
          }
        }
      })
      .catch((e) => {
        reject(e);
      });
  });
}

/**
 * Extract items from payload received from FoxyCart
 *
 * @param {string} body of the response received from Webflow
 * @returns {Array} an array of items
 */
function extractItems(body) {
  const objBody = JSON.parse(body);
  if (objBody && objBody._embedded && objBody._embedded["fx:items"]) {
    return objBody._embedded["fx:items"];
  }
  return [];
}

/**
 * Creates a cache object to store collection items and avoid repeated requests to webflow within the same execution.
 *
 * This cache is not intended to persist data between requests, but to simplify getting the Webflow Items in the same request.
 *
 * @returns {{addItems: Function, cache: object, findItem: Function}} a Cache object
 */
function createCache() {
  return {
    addItems(collection, items) {
      if (!this.cache[collection]) {
        this.cache[collection] = [];
      }
      this.cache[collection] = this.cache[collection].concat(items);
    },
    cache: {},
    findItem(collection, item) {
      if (!this.cache[collection]) {
        return null;
      }
      return this.cache[collection].find((e) => {
        const itemCode = item.code;
        const wfCode = getOption(e, "code").value;
        return (
          itemCode &&
          wfCode &&
          wfCode.toString().trim() === itemCode.toString().trim()
        );
      });
    },
  };
}

/**
 * Validation checks
 */
const validation = {
  configuration: {
    response: () => ({
      body: JSON.stringify({
        details: "Webflow token not configured.",
        ok: false,
      }),
      statusCode: 503,
    }),
    validate: () => !!config.datastore.provider.webflow.token,
  },
  input: {
    errorMessage: "",
    response: function () {
      return {
        body: JSON.stringify({ details: this.errorMessage, ok: false }),
        statusCode: 400,
      };
    },
    validate: function (requestEvent) {
      this.errorMessage = FoxyWebhook.validFoxyRequest(requestEvent);
      return !this.errorMessage;
    },
  },
};

/**
 * Returns a value from an object given a case-insensitive key
 *
 * @param {object} object the object to get the value from
 * @param {string} key field to get the value from
 * @returns {any} the value stored in the key
 */
function iGet(object, key) {
  const numbered = new RegExp(key.toLowerCase().trim() + "(-\\d+)?");
  const existingKey = Object.keys(object)
    .filter((k) => k.toLowerCase().trim().match(numbered))
    .sort();
  return object[existingKey[0]];
}

/**
 * Get an option of an item.
 *
 * The option may be set in the object itself or in the fx:item_options property of the _embedded attribute
 *
 * @param {object} item the item that should have the option
 * @param {string} option to be retrieved
 * @returns {{}|{name: string, value: string|number}} name and value of the option
 *  returns an empty object if the option is not available
 */
function getOption(item, option) {
  let found = iGet(item, option);
  if (found) return { name: option, value: iGet(item, option) };
  if (item._embedded) {
    if (item._embedded["fx:item_options"]) {
      found = item._embedded["fx:item_options"].find(
        (e) => e.name.toLowerCase().trim() === option.toLowerCase().trim()
      );
      if (found) return found;
    }
  }
  return {};
}
