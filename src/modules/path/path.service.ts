import { HttpService } from '@nestjs/axios';
import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { COSMOS_MANIFESTS, CosmosHubChains } from '../../constants/manifests';
import { Interval, Timeout } from '@nestjs/schedule';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';
import { InjectRepository } from '@nestjs/typeorm';
import { PathEntity } from './path.entity';
import { Repository } from 'typeorm';
import { GetRouteDto } from './dtos/get-route.dto';
import * as _ from 'lodash';
import { StaticPool } from 'node-worker-threads-pool';
import { QueryDeepPartialEntity } from 'typeorm/query-builder/QueryPartialEntity';
import { Worker } from 'worker_threads';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';

@Injectable()
export class PathService {
  public mappingChainId: { [key: string]: string };
  private staticPool: any;
  private _pendingSaveEntities: QueryDeepPartialEntity<PathEntity>[];
  private _pendingSaveAggregator: NodeJS.Timer;
  constructor(
    private readonly httpService: HttpService,
    @Inject(CACHE_MANAGER)
    private readonly cacheManager: Cache,
    @InjectRepository(PathEntity)
    private readonly pathRepository: Repository<PathEntity>,
    @InjectQueue('ibc:path')
    private readonly pathQueue: Queue,
  ) {}

  // async savePaths(entity: Partial<PathEntity>) {
  //   if (this._pendingSaveEntities === null) {
  //     this._pendingSaveEntities = [];
  //   }
  //   this._pendingSaveEntities.push(entity);
  //   if (!this._pendingSaveAggregator) {
  //     this._pendingSaveAggregator = setTimeout(async () => {
  //       const entities = this._pendingSaveEntities;
  //       this._pendingSaveEntities = null;
  //       this._pendingSaveAggregator = null;
  //       return this.pathRepository.upsert(entities, [
  //         'denom',
  //         'sourceChain',
  //         'destChain',
  //       ]);
  //     }, 10);
  //   }
  //   console.log("🚀 ~ PathService ~ savePaths ~ this._pendingSaveEntities:", this._pendingSaveEntities)
  // }
  async savePaths(entity: Partial<PathEntity>) {
    return this.pathRepository.upsert(entity, [
      'denom',
      'sourceChain',
      'destChain',
    ]);
  }

  async getRoute(dto: GetRouteDto) {
    const { denom, derivePath } = dto;
    const [sourceChain, destChain] = derivePath.split('_');
    console.log('🚀 ~ PathService ~ getRoute ~ denom:', denom);
    console.log(
      '🚀 ~ PathService ~ getRoute ~ derivePath:',
      sourceChain,
      destChain,
    );
    const directlyRoute = await this.pathRepository.findOneBy({
      denom,
      sourceChain,
      destChain,
    });
    if (directlyRoute) {
      return [directlyRoute.metadata];
    }
    let bestRoute = null;
    let bestRouteLength = Number.POSITIVE_INFINITY;
    const findPath = async (
      _sourceChain: string,
      maxHops: number = 3,
      res: any[] = [],
      chains: string = '',
    ) => {
      console.log(
        '🚀 ~ PathService ~ getRoute ~ res:',
        `${chains}_${_sourceChain}`,
      );
      if (res.length >= bestRouteLength || maxHops === 0) {
        return;
      }
      const paths = await this.pathRepository.findBy({
        denom,
        sourceChain: _sourceChain,
      });
      console.log('🚀 ~ PathService ~ getRoute ~ paths:', paths);
      if (paths.length === 0) {
        return;
      }
      const isDestChain = paths.find((path) => path.destChain === destChain);
      if (isDestChain) {
        bestRoute = [...res, isDestChain.metadata];
        bestRouteLength = bestRoute.length;
        return;
      }
      await Promise.all(
        paths.map((path) =>
          findPath(
            path.destChain,
            maxHops - 1,
            [...res, path.metadata],
            `${chains}_${sourceChain}`,
          ),
        ),
      );
    };

    await findPath(sourceChain);
    if (!bestRoute) {
      throw new NotFoundException('Route not found');
    }

    return bestRoute;
  }

  async getAllDenom(chain: CosmosHubChains) {
    console.log('🚀 ~ PathService ~ getAllDenom ~ chain:', chain);
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
    console.log(
      '🚀 ~ PathService ~ getAllDenom ~ paths:',
      paths.filter((path) => path).length,
    );
    await this.formatPaths(paths.filter((path) => path));
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
      return null;
    }
  }

  async formatPaths(paths: any[]) {
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
      await this.pathRepository.upsert(
        [
          {
            denom: denomOut,
            metadata: {
              denomIn,
              denomOut,
              sourceChain,
              destChain,
              channelId,
              portId,
            },
          },
          {
            denom: denomOut,
            metadata: {
              denomIn: denomOut,
              denomOut: denomIn,
              sourceChain: destChain,
              destChain: sourceChain,
              channelId: counterpartyChannelId,
              portId: portId,
            },
          },
        ],
        ['denom', 'derivePath'],
      );
    }
  }

  async getAllIBCs() {
    const { data: ibcTokens } = await this.httpService.axiosRef.get(
      'https://raw.githubusercontent.com/PulsarDefi/IBC-Token-Data-Cosmos/main/ibc_data.min.json',
    );
    return ibcTokens;
    /*
    const res = {};
    for (const ibc of Object.values(ibcTokens) as any[]) {
      if (!ibc.chain || !ibc.origin.chain) continue;
      if (ibc.chain in CosmosHubChains || ibc.origin.chain in CosmosHubChains) {
        console.log('🚀 ~ PathService ~ getAllIBCs ~ ibc:', ibc.origin.denom);
        const [portId, channelId] = ibc.path.split('/');
        await this.pathRepository.upsert(
          {
            denom: ibc.origin.denom,
            sourceChain: ibc.chain,
            destChain: ibc.origin.chain,
            metadata: {
              chain: this.mappingChainId[String(ibc.chain)],
              portId: portId,
              channelId: channelId,
              address: ibc.origin.denom,
            } as any,
          },
          ['denom', 'sourceChain', 'destChain'],
        );
        if (ibc.chain in CosmosHubChains) {
          const rpcEndpoint = COSMOS_MANIFESTS[ibc.origin.chain].lcdURL;
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
            await this.pathRepository.upsert(
              {
                denom: ibc.origin.denom,
                sourceChain: ibc.origin.chain,
                destChain: ibc.chain,
                metadata: {
                  chain: this.mappingChainId[String(ibc.origin.chain)],
                  portId: portId,
                  channelId: counterpartyChannelId,
                  address: ibc.origin.denom,
                } as any,
              },
              ['denom', 'sourceChain', 'destChain'],
            );
          } catch (error) {
            continue;
          }
        }
      }
    }
    await fs.writeFileSync('./icb-paths.json', JSON.stringify(res, null, 2));
    */
  }

  @Timeout(0)
  async buildPaths() {
    console.log('Start');
    if (!this.mappingChainId) {
      await this.getChainInfo();
    }

    const ibcTokens = await this.getAllIBCs();
    await Promise.all(
      (Object.values(ibcTokens) as any[])
        .map((ibc) => this.pathQueue.add(ibc.chain, ibc)),
    );
    // console.log("🚀 ~ PathService ~ buildPaths ~ ibcTokens:", ibcTokens.length)
    // const chunkData = _.chunk(Object.values(ibcTokens), 2500);
    // console.log(
    //   '🚀 ~ PathService ~ buildPaths ~ chunkData:',
    //   chunkData.length,
    //   chunkData[0].length,
    //   chunkData[chunkData.length - 1].length,
    // );

    // const workers = [];
    // for (const records of chunkData) {
    //   const workerData = {
    //     ibcTokens: records,
    //     CosmosHubChains: CosmosHubChains,
    //     mappingChainId: this.mappingChainId,
    //     // savePaths: this.savePaths.bind(this),
    //     COSMOS_MANIFESTS: COSMOS_MANIFESTS,
    //   };

    //   const worker = new Worker('./dist/modules/path/path.worker.js', {
    //     workerData,
    //   });

    //   workers.push(worker);

    //   worker.on('message', (message) => {
    //     if (message.res) {
    //       this.pathRepository.upsert(message.res, [
    //         'denom',
    //         'sourceChain',
    //         'destChain',
    //       ]);
    //     }
    //   });

    //   worker.on('error', (error) => {
    //     console.error('Worker error:', error);
    //   });

    //   worker.on('exit', (code) => {
    //     if (code !== 0) {
    //       console.error(`Worker stopped with exit code ${code}`);
    //     }
    //   });
    // }

    // await Promise.all(
    //   workers.map(
    //     (worker) =>
    //       new Promise((resolve) => {
    //         worker.on('exit', resolve);
    //       }),
    //   ),
    // );

    // console.log('All workers finished processing.');
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
      this.mappingChainId[chain.name] = chain.chain_id;
    }
    this.mappingChainId['cosmos'] = 'cosmoshub-4';
    console.log(
      '🚀 ~ PathService ~ getChainInfo ~ this.mappingChainId:',
      this.mappingChainId,
    );
  }
}
