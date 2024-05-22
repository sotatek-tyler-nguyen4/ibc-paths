import { Processor } from '@nestjs/bullmq';
import { COSMOS_MANIFESTS, CosmosHubChains } from 'src/constants/manifests';
import { WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { PathService } from './path.service';
import { HttpService } from '@nestjs/axios';

@Processor('ibc:path', {
  concurrency: 200,
})
export class PathConsumer extends WorkerHost {
  constructor(
    private readonly service: PathService,
    private readonly httpService: HttpService,
  ) {
    super();
  }
  async process(job: Job<any, any, string>, token?: string): Promise<any> {
    const ibc = job.data;
    console.log('🚀 ~ PathService ~ getAllIBCs ~ ibc:', ibc.origin.denom);
    const [portId, channelId] = ibc.path.split('/');
    await this.service.savePaths({
      denom: ibc.origin.denom,
      sourceChain: ibc.chain,
      destChain: ibc.origin.chain,
      metadata: {
        chain: this.service.mappingChainId[String(ibc.chain)],
        portId: portId,
        channelId: channelId,
        address: ibc.origin.denom,
      } as any,
    });
    const rpcEndpoint = COSMOS_MANIFESTS[ibc.origin.chain].lcdURL;
    if (ibc.chain in CosmosHubChains) {
      try {
        const {
          data: {
            channel: {
              counterparty: { channel_id: counterpartyChannelId },
            },
          },
        } = await this.httpService.axiosRef.get(
          `${rpcEndpoint}/ibc/core/channel/v1/channels/${channelId}/ports/${portId}`,
        );
        console.log(
          '🚀 ~ PathService ~ getAllIBCs ~ counterpartyChannelId:',
          counterpartyChannelId,
        );
        await this.service.savePaths({
          denom: ibc.origin.denom,
          sourceChain: ibc.origin.chain,
          destChain: ibc.chain,
          metadata: {
            chain: this.service.mappingChainId[String(ibc.origin.chain)],
            portId: portId,
            channelId: counterpartyChannelId,
            address: ibc.origin.denom,
          } as any,
        });
      } catch (error) {
        return;
      }
    }
  }
}
