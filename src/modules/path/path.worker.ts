const { parentPort } = require('worker_threads');
const axios = require('axios');

parentPort.on(
  'message',
  async ({ ibcTokens, CosmosHubChains, mappingChainId, COSMOS_MANIFESTS }) => {
    try {
      const results = await Promise.all(
        ibcTokens
          .filter(
            (ibc) =>
              ibc.chain &&
              ibc.origin.chain &&
              (ibc.chain in CosmosHubChains ||
                ibc.origin.chain in CosmosHubChains),
          )
          .map(async (ibc) => {
            console.log("🚀 ~ .map ~ ibc:", ibc.origin.denom)
            const [portId, channelId] = ibc.path.split('/');
            const baseResult = {
              denom: ibc.origin.denom,
              sourceChain: ibc.chain,
              destChain: ibc.origin.chain,
              metadata: {
                chain: mappingChainId[String(ibc.chain)],
                portId: portId,
                channelId: channelId,
                address: ibc.origin.denom,
              },
            };

            // Handle CosmosHub chain case
            if (ibc.chain in CosmosHubChains) {
              try {
                const rpcEndpoint = COSMOS_MANIFESTS[ibc.chain].lcdURL;
                const response = await axios.get(
                  `${rpcEndpoint}/ibc/core/channel/v1/channels/${channelId}/ports/${portId}`,
                );
                const counterpartyChannelId =
                  response.data.channel.counterparty.channel_id;

                return [
                  baseResult,
                  {
                    denom: ibc.origin.denom,
                    sourceChain: ibc.origin.chain,
                    destChain: ibc.chain,
                    metadata: {
                      chain: mappingChainId[String(ibc.chain)],
                      portId: portId,
                      channelId: counterpartyChannelId,
                      address: ibc.origin.denom,
                    },
                  },
                ];
              } catch (error) {
                console.error('Error processing chain:', ibc.chain, error);
                return baseResult;
              }
            }

            return baseResult;
          }),
      );

      parentPort.postMessage({ res: results.flat() });
    } catch (error) {
      console.error('Unexpected error in worker thread:', error);
      parentPort.postMessage({ error }); // Send error message back to main thread
    }
  },
);
