import { HttpService } from '@nestjs/axios';
import { Injectable } from '@nestjs/common';
import { COSMOS_MANIFESTS, CosmosHubChains } from '../../constants/manifests';
import { Interval } from '@nestjs/schedule';
import * as fs from 'fs';

@Injectable()
export class PathService {
  private mappingChainId: { [key: string]: string };
  private dataCache = {};
  constructor(private readonly httpService: HttpService) {}

  async getAllDenom(chain: CosmosHubChains) {
    if (!this.mappingChainId) {
      await this.getChainInfo();
    }
    const rpcEndpoint = COSMOS_MANIFESTS[chain].lcdURL;
    const { data } = await this.httpService.axiosRef.get(
      `${rpcEndpoint}/ibc/apps/transfer/v1/denom_traces`,
    );
    const denomTraces = data.denom_traces;
    const paths = await Promise.all(
      denomTraces.map(({ path, base_denom }) => {
        const sliptPath = path.split('/');
        if (sliptPath > 2) {
          return null;
        }
        return this.buildPath(base_denom, sliptPath[0], sliptPath[1], chain);
      }),
    );
    await this.formatPaths(paths.filter(path => path));
  }

  async buildPath(
    denom: string,
    portId: string,
    channelId: string,
    chain: CosmosHubChains,
  ) {
    try {
      const rpcEndpoint = COSMOS_MANIFESTS[chain].lcdURL;
      const {
        data: { hash: ibcDenomHashes },
      } = await this.httpService.axiosRef.get(
        `${rpcEndpoint}/ibc/apps/transfer/v1/denom_hashes/${portId}/${channelId}/${denom}`,
      );
      if (ibcDenomHashes) {
        // console.log('🚀 ~ PathService ~ ibcDenomHashes:', ibcDenomHashes);
        const {
          data: {
            identified_client_state: { client_state: client },
          },
        } = await this.httpService.axiosRef.get(
          `${rpcEndpoint}/ibc/core/channel/v1/channels/${channelId}/ports/${portId}/client_state`,
        );
        // console.log('🚀 ~ PathService ~ client:', client);

        const {
          data: {
            channel: {
              counterparty: { channel_id: counterpartyChannelId },
            },
          },
        } = await this.httpService.axiosRef.get(
          `${rpcEndpoint}/ibc/core/channel/v1/channels/${channelId}/ports/${portId}`,
        );
        return {
          denomIn: `ibc/${ibcDenomHashes}`,
          denomOut: denom,
          sourceChain: chain,
          destChain: this.mappingChainId[client.chain_id],
          channelId: channelId,
          counterpartyChannelId: counterpartyChannelId,
          portId: portId,
        };
      }
      return null;
    } catch (error) {
      //   console.log("🚀 ~ PathService ~ error:", error)
      return null;
    }
  }

   formatPaths(paths: any[]) {
    for (const path of paths) {
      const {
        denomIn,
        denomOut,
        sourceChain,
        destChain,
        channelId,
        counterpartyChannelId,
        portId,
      } = path;
      if (!this.dataCache[denomOut]) {
        this.dataCache[denomOut] = {};
      }
      this.dataCache[denomOut][`${sourceChain}_${destChain}`] = {
        denomIn,
        denomOut,
        sourceChain,
        destChain,
        channelId,
        portId,
      };
      this.dataCache[denomOut][`${destChain}_${sourceChain}`] = {
        denomIn: denomOut,
        denomOut: denomIn,
        sourceChain: destChain,
        destChain: sourceChain,
        channelId: counterpartyChannelId,
        portId: portId,
      };
    }
  }

  @Interval( 1000)
  async buildPaths() {
    await this.getAllDenom(CosmosHubChains.osmosis);
    const jsonData = JSON.stringify(this.dataCache, null, 2); // Pretty-print JSON with 2-space indentation
    console.log("🚀 ~ PathService ~ getAllDenom ~ jsonData:", jsonData);
    fs.writeFileSync('./ibc-path.json', jsonData);
  }

  @Interval(24 * 60 * 60 * 1000)
  async getChainInfo() {
    const {
      data: { chains },
    } = await this.httpService.axiosRef.get('https://chains.cosmos.directory');
    if (!this.mappingChainId) {
      this.mappingChainId = {};
    }
    for (const chain of chains) {
      this.mappingChainId[chain.chain_id] = chain.name;
    }
    console.log(
      '🚀 ~ getTokenInfo ~ this.mappingChainId:',
      this.mappingChainId,
    );
  }
}
