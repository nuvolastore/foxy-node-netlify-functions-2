# Inventory update webhook for Webflow-FoxyCart NUVOLA

This webhook assumes you are using a Webflow CMS Collection to store your products.

It provides you with a function to update inventory in your Webflow Products CMS collection.

#### Limitations

- Due to netlify time limit and webflow request limit, it will break on collections with thousands of products

## Usage

1. Read the short configuration section bellow to make sure your Webflow Collection and FoxyCart links are all set;
   - **Important**: your webflow collection and your add to cart buttons/forms need to be properly configured for the webhook to work. Product items need a `code` field.
1. Grab your Webflow token: https://university.webflow.com/lesson/intro-to-the-webflow-api#generating-an-api-access-token;
1. Click the **deploy to Netlify** button at the end of this page. Netlify will provide you with a form for you to provide your configuration. The WInventory update webhook requires only `FOXY_WEBFLOW_TOKEN`.
1. Grab the URL for your webhook in Netlify. Be sure to get the correct URL for the datastore-integration-webflow-nvl. To do this, after the deploy is finished, click the "functions" tab, look for `datastore-integration-webflow-nvl` function and copy the **Endpoint URL**.
1. Configure your Inventory update webhook using your endpoint. Check the docs here: https://wiki.foxycart.com/v/2.0/pre_payment_webhook

## Webflow Setup

In order to use this webhook you'll need to set your Webflow collection, create buttons or forms to add the products to the cart and setup your webhook.

### In your Webflow collection, add the necessary fields

The webflow collection needs to have the following fields:

| Parameter                                        | Description                                                                                                                              | Example value in a Webflow Item |
| ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------- |
| `code` or the parameter set in `FOXY_FIELD_CODE` | for each item. You can use your `slug` if you don't have a unique field, simply set `FOXY_FIELD_CODE` to slug (see configuration bellow) | `code=896EYSA678`               |
| `price`                                          | The price to be validated.                                                                                                               | `price=256.88`                  |

### When creating your FoxyCart Items

When adding your items to the cart, beyond `price` and `quantity` that are needed for the cart, you'll need to provide the following information for the validation to work:

| Parameter | Description                                   | Example           |
| --------- | --------------------------------------------- | ----------------- |
| `code`    | **Required** The item's code. Must be unique. | `code=896EYSA678` |

### When configuring your webhook server

It is necessary to provide the Webflow token as an environment variable named `WEBFLOW_TOKEN`.

#### Configuration

| `FOXY_WEBFLOW_COLLECTION` | "" | The id of the collection that contains the products. If this is set, there is no need to set `collection_id` in the HTML. |

## Examples

### Basic Example: no customization

Here is a minimum example of a link button to add a product to the cart (the line breaks are for readability):

```html
<a
  class="button"
  href="https://YOURDOMAIN.foxycart.com/cart?
                        name=A+great+product&
                        price=5&
                        code=123456&
                        collection_id=123047812340791234"
>
  Buy this Great Product!
</a>
```

Here is what will happen in the validation considering the example above:

The webhook:

- will assume that there is a field name `inventory` in your Webflow collection.
- will assume that there is a field named `code` in your Webflow collection.
- will assume that there is a field named `price` in your Webflow collection.
- will fetch the data from your collection directly, find the right `code` and compare the `price` field. It will approve the purchase if the price is the same as it is stored in your collection, and the inventory is sufficient.

# Deploy your webhook

These are instructions for deploying the webhook to Netlify.

### First: clone this repository

Click the fork button in the top right corner.

Cloning the repository will create your own copy of this Webhook, allowing you to both customize it if you wish and to merge upgrades as they are published.

### Second: create a new Netlify Site

Go to your Netlify account and click the "New site from Git" button.

- Choose your repository.
- Click the "Advanced" button and then "New Variable"
  - The key should be: `WEBFLOW_TOKEN`
  - To get this token, go to Webflow's project settings, at the 'Integrations' tab."
