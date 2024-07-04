import { NextApiRequest, NextApiResponse } from "next";

import { apiResponse } from "src/types/api-response";
import NetworkType from "src/types/network-type";
import TransactionResult from "src/types/transaction-result";
import { CountryConfigMap } from "src/utils/account-management-helpers";
import { handlerMapping } from "src/utils/api-helpers";
import { getSessionForServerSide } from "src/utils/session-helpers";
import stripeClient from "src/utils/stripe-loader";

const handler = async (req: NextApiRequest, res: NextApiResponse) =>
  handlerMapping(req, res, {
    POST: sendMoney,
  });

const sendMoney = async (req: NextApiRequest, res: NextApiResponse) => {
  const session = await getSessionForServerSide(req, res);
  const { stripeAccount, country } = session;
  const { accountId, platform } = stripeAccount;
  const stripe = stripeClient(platform);

  let amountString = req.body.amount.toString();
  if (amountString.includes(".")) {
    amountString = amountString.replace(".", "");
  } else {
    amountString = (parseFloat(amountString) * 100).toString();
  }
  const amount = parseInt(amountString);

  // Get financial accounts for the Connected Account
  const financialAccounts = await stripe.treasury.financialAccounts.list(
    { expand: ["data.financial_addresses.aba.account_number"] },
    { stripeAccount: accountId },
  );
  const financialAccount = financialAccounts.data[0];

  /* The following example uses hardcoded values for demo mode */

  let city, state, postal_code, line1;

  /* Wire transfers require the address of the recipient. */

  if (req.body.network == NetworkType.US_DOMESTIC_WIRE) {
    city = req.body.city;
    state = req.body.state;
    postal_code = req.body.postalCode;
    line1 = req.body.line1;
  } else {
    city = "Alvin";
    state = "TX";
    postal_code = "77511";
    line1 = "123 Main St.";
  }

  const outboundPayment = await stripe.treasury.outboundPayments.create(
    {
      financial_account: financialAccount.id,
      amount: amount,
      currency: CountryConfigMap[country].currency,
      statement_descriptor: "Descriptor",
      destination_payment_method_data: {
        type: "us_bank_account",
        us_bank_account: {
          account_holder_type: "company",
          routing_number: "110000000",
          account_number: "000000000009",
        },
        billing_details: {
          email: "jenny@example.com",
          phone: "7135551212",
          address: {
            city: city,
            state: state,
            postal_code: postal_code,
            line1: line1,
            country: "US",
          },
          name: req.body.name,
        },
      },
      destination_payment_method_options: {
        us_bank_account: {
          network: req.body.network,
        },
      },
    },
    { stripeAccount: accountId },
  );

  if (req.body.transaction_result == TransactionResult.POSTED) {
    await stripe.testHelpers.treasury.outboundPayments.post(
      outboundPayment.id,
      { stripeAccount: accountId },
    );
  }
  // TODO: Handle the return status of the transaction result
  if (req.body.transaction_result == TransactionResult.FAILED) {
    await stripe.testHelpers.treasury.outboundPayments.fail(
      outboundPayment.id,
      { stripeAccount: accountId },
    );
  }

  /* Call test helper and set new status
     Outbound payment is generated by using a test bank account that leaves the payment on pending status
     Outbound payment status will be set using the test helper, unless it is processing, in that case nothing will change.
  */

  return res.status(200).json(apiResponse({ success: true }));
};

export default handler;
