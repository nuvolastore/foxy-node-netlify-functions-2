const FoxyWebhook = require("../../foxy/FoxyWebhook.js");
const Webflow = require("webflow-api");
const { config } = require("../../../config.js");
const webFlowCollectionID = config.datastore.provider.webflow.collection;

exports.handler = async (requestEvent) => {
  console.log(requestEvent.body);
};

// Helper functions

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
  if (offset > 500) {
    console.log("   ... giving up.");
    return Promise.reject(new Error("Item not found"));
  }
  if (offset) {
    console.log("   ... couldn't find the item in first", offset, "items.");
  }
  const collectionId = getCollectionId(foxyItem);
  const webflow = getWebflow();
  const found = cache.findItem(collectionId, foxyItem);
  if (found) {
    return Promise.resolve(enrichFetchedItem(found, foxyItem));
  }
  return new Promise((resolve, reject) => {
    webflow
      .items(
        { collectionId },
        {
          limit: customOptions().webflow.limit,
          offset,
          sort: [getCustomKey("code"), "ASC"],
        }
      )
      .then((collection) => {
        cache.addItems(collectionId, collection.items);
        let code_exists = null;
        const match = collection.items.find((e) => {
          const wfItemCode = iGet(e, getCustomKey("code"));
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
            new Error(`Could not find the code field (${getCustomKey(
              "code"
            )}) in Webflow.
              this field must exist and not be empty for all items in the collection.`)
          );
        } else {
          if (match) {
            resolve(enrichFetchedItem(match, foxyItem));
          } else if (collection.total > collection.offset + collection.count) {
            fetchItem(
              cache,
              foxyItem,
              (offset / customOptions().webflow.limit + 1) *
                customOptions().webflow.limit
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
        const wfCode = getCustomizableOption(e, "code").value;
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
