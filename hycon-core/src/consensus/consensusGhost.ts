
import { Block, BlockHeader, Hash } from "hycon-common"
import { getLogger } from "log4js"
import Long = require("long")
import { Consensus, IPutResult } from "./consensus"
import { Database } from "./database/database"
import { DBBlock } from "./database/dbblock"
import { DifficultyAdjuster } from "./difficultyAdjuster"
import { BlockStatus } from "./sync"
import { EMA, IUncleCandidate, maxNumberOfUncles, maxUncleHeightDelta, recentHeaderTrackingRange, UncleManager } from "./uncleManager"

const logger = getLogger("Ghost Consensus")

export class GhostConsensus {
    public static readonly BLOCK_REWARD = 120e9
    public static readonly TARGET_MEAN_TIME = 15000 / Math.LN2
    public static async checkNonce(preHash: Uint8Array, nonce: Long, difficulty: number): Promise<boolean> {
        // Consensus Critical
        const hash = await Consensus.cryptonightHashNonce(preHash, nonce)
        const target = this.getTarget(difficulty)
        return DifficultyAdjuster.acceptable(hash, target)
    }

    public static getTarget(p: number, length: number = 32) {
        // Consensus Critical
        if (p > 1) {
            logger.warn(`Difficulty(${p.toExponential()}) is too low, anything is possible. (　＾∇＾)`)
            p = 1
        }
        if (p < Math.pow(0x100, -length)) {
            logger.warn(`Difficulty(${p.toExponential()}) is too high, give up now. (╯°□°）╯︵ ┻━┻`)
            p = Math.pow(0x100, -length)
        }
        const target = Buffer.allocUnsafe(length)
        let carry = p
        for (let i = target.length - 1; i >= 0; i--) {
            carry *= 0x100
            target[i] = Math.floor(carry)
            carry -= target[i]
        }
        for (let i = 0; i < target.length; i++) {
            target[i]--
            if (target[i] !== 0xFF) {
                break
            }
        }
        return target
    }
    private consensus: Consensus
    private db: Database
    private uncleManager: UncleManager
    private readonly targetTime: number

    constructor(consensus: Consensus, db: Database, uncleManager: UncleManager) {
        this.consensus = consensus
        this.db = db
        this.uncleManager = uncleManager
    }

    public async process(result: IPutResult, previousDBBlock: DBBlock, previousBlockStatus: BlockStatus, hash: Hash, header: BlockHeader, block?: Block): Promise<IPutResult> {
        // Consensus Critical
        if (result.oldStatus === BlockStatus.Nothing) {
            await this.processHeader(previousDBBlock, previousBlockStatus, header, hash, result)
            if (result.status === BlockStatus.Rejected) {
                return result
            }
        }

        if (block === undefined || previousBlockStatus < BlockStatus.Block) {
            return result
        }

        if (result.oldStatus >= BlockStatus.Nothing && result.oldStatus <= BlockStatus.Header) {
            if (result.dbBlock === undefined) { result.dbBlock = await this.db.getDBBlock(hash) }
            await this.processBlock(block, hash, header, previousDBBlock, result)
            if (result.status !== BlockStatus.Block) {
                return result
            }
        }
        return result
    }
    private async processHeader(previousDBBlock: DBBlock, previousBlockStatus: BlockStatus, header: BlockHeader, hash: Hash, result: IPutResult): Promise<void> {
        // Consensus Critical
        if (header.timeStamp < previousDBBlock.header.timeStamp + 50) {
            result.status = BlockStatus.Rejected
            return
        }

        if (header.previousHash.length > maxNumberOfUncles + 1) {
            logger.warn(`Rejecting header(${hash.toString()}): Header has too many uncles(${header.previousHash.length - 1}) the maximum is ${maxNumberOfUncles}`)
            result.status = BlockStatus.Rejected
            return
        }

        if (previousDBBlock.nextDifficulty !== header.difficulty) {
            logger.warn(`Rejecting header(${hash.toString()}): Difficulty(${header.difficulty}) does not match calculated value(${previousDBBlock.nextDifficulty})`)
            result.status = BlockStatus.Rejected
            return
        }

        const preHash = header.preHash()
        const nonceCheck = await GhostConsensus.checkNonce(preHash, header.nonce, header.difficulty)
        if (!nonceCheck) {
            logger.warn(`Rejecting header(${hash.toString()}): Hash does not meet difficulty(${header.difficulty})`)
            result.status = BlockStatus.Rejected
            return
        }

        const height = previousDBBlock.height + 1

        await this.uncleManager.setUncleHeader(height, hash, header.miner)

        const work = 1 / previousDBBlock.nextDifficulty
        const workEMA = EMA(work, previousDBBlock.pEMA)
        const totalWork = previousDBBlock.totalWork + work

        const timeDelta = previousDBBlock.height > 0 ? header.timeStamp - previousDBBlock.header.timeStamp : GhostConsensus.TARGET_MEAN_TIME
        const tEMA = EMA(timeDelta, previousDBBlock.tEMA)

        const hashesPerSecond = workEMA / tEMA
        const nextBlockTargetHashes = hashesPerSecond * GhostConsensus.TARGET_MEAN_TIME
        const nextDifficulty = 1 / nextBlockTargetHashes

        result.dbBlock = new DBBlock({ header, height, tEMA, pEMA: workEMA, nextDifficulty, totalWork })
        result.status = BlockStatus.Header
        return
    }

    private async processUncles(header: BlockHeader, previousDBBlock: DBBlock, result: IPutResult) {
        const blockHash = new Hash(header)
        const uncleHashes = header.previousHash.slice(1)
        const uncleHashStrings = new Set<string>()
        const uncleStatusPromises = [] as Array<Promise<{ status: BlockStatus, hash: Hash }>>
        for (const uncleHash of uncleHashes) {
            const uncleHashString = uncleHash.toString()
            if (uncleHashStrings.has(uncleHashString)) {
                continue
            }
            uncleHashStrings.add(uncleHashString)
            const unclePromise = this.db.getBlockStatus(uncleHash).then((status) => ({ status, hash: uncleHash }))
            uncleStatusPromises.push(unclePromise)
        }
        const uncleStatuses = await Promise.all(uncleStatusPromises)
        const missingHashes = [] as Hash[]
        let invalidUncle = false
        for (const uncle of uncleStatuses) {
            switch (uncle.status) {
                case BlockStatus.InvalidBlock: // Header Ok, only block/uncles failed validation
                case BlockStatus.Header: // Ok
                case BlockStatus.Block: // Ok
                case BlockStatus.MainChain: // Not Ok, but may change during reorganization
                    continue
                case BlockStatus.Nothing: // Not Ok, Can not calculate the totalWork
                    missingHashes.push(uncle.hash)
                    invalidUncle = true
                    logger.warn(`Block(${blockHash})'s Uncle(${uncle.hash}) status is missing`)
                    break
                case BlockStatus.Rejected: // Not Ok
                    logger.warn(`Block(${blockHash})'s Uncle(${uncle.hash}) status is rejected`)
                    invalidUncle = true
                    result.status = BlockStatus.InvalidBlock
                    break
            }
        }

        if (missingHashes.length > 0) {
            this.consensus.emit("missingUncles", previousDBBlock.height + 1, missingHashes)
            return
        }
        if (invalidUncle) {
            return
        }
        const unclePromises = uncleStatuses.map((uncle) =>
            this.db.getDBBlock(uncle.hash).then((uncleDBBlock) => ({
                dbblock: uncleDBBlock,
                hash: uncle.hash,
                status: uncle.status,
            })),
        )
        const uncles = await Promise.all(unclePromises)

        let totalWorkAdjustment = 0
        const candidates = [] as IUncleCandidate[]
        for (const uncle of uncles) {
            const heightDelta = result.dbBlock.height - uncle.dbblock.height
            if (heightDelta > maxUncleHeightDelta || !(uncle.dbblock.header instanceof BlockHeader)) {
                logger.warn(`Block(${blockHash})'s Uncle(${uncle.hash}) heightDelta is too large ${heightDelta}`)
                result.status = BlockStatus.InvalidBlock
                return
            }
            const uncleWork = 1 / uncle.dbblock.header.difficulty
            totalWorkAdjustment += uncleWork
            candidates.push({ hash: uncle.hash, height: uncle.dbblock.height, miner: uncle.dbblock.header.miner })
        }
        logger.debug(`Block ${result.dbBlock.height}: ${result.dbBlock.pEMA.toFixed(1)} H / ${(result.dbBlock.tEMA / 1000).toFixed(1)}s = ${(result.dbBlock.pEMA * 1000 / result.dbBlock.tEMA).toFixed(1)}H/s`)
        return { totalWorkAdjustment, candidates }
    }

    private async processBlock(block: Block, hash: Hash, header: BlockHeader, previousDBBlock: DBBlock, result: IPutResult): Promise<void> {
        // Consensus Critical
        const height = previousDBBlock.height + 1
        const uncles = await this.processUncles(header, previousDBBlock, result)
        if (!uncles) {
            logger.error(`Failed to process uncle: ${hash}`)
            return
        }

        await this.consensus.processBlock(block, hash, header, previousDBBlock, result, GhostConsensus.BLOCK_REWARD, true, uncles.candidates)
        if (result.status !== BlockStatus.Block) {
            return
        }
        result.dbBlock.totalWork += uncles.totalWorkAdjustment
        return
    }
}
