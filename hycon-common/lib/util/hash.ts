import Base58 = require("base-58")
import blake2b = require("blake2b")
import { Account } from "../common/account"
import { Block } from "../common/block"
import { GenesisBlock } from "../common/blockGenesis"
import { BlockHeader } from "../common/blockHeader"
import { BaseBlockHeader, GenesisBlockHeader } from "../common/genesisHeader"
import { StateNode } from "../common/stateNode"
import { Tx } from "../common/tx"
import { GenesisTx } from "../common/txGenesis"
import { GenesisSignedTx } from "../common/txGenesisSigned"
import { SignedTx } from "../common/txSigned"
import * as proto from "../serialization/proto"

function toUint8Array(ob?: Tx | Block | GenesisBlock | GenesisBlockHeader | BlockHeader | string | SignedTx | GenesisTx | GenesisSignedTx | StateNode | Account | Uint8Array | Buffer): Uint8Array {
    // Consensus Critical
    if (ob !== undefined) {
        if (typeof ob === "string") {
            return Hash.hash(ob)
        } else if (ob instanceof Uint8Array || ob instanceof Buffer) {
            if (ob.length !== 32) {
                throw new Error(`Hash length ${ob.length} but should be 32`)
            }
            return ob
        } else if (ob instanceof SignedTx || ob instanceof GenesisSignedTx) {
            let unsignedTx = {
                amount: ob.amount,
                to: ob.to,
            }
            if (ob instanceof SignedTx) {
                unsignedTx = Object.assign(unsignedTx, {
                    fee: ob.fee,
                    from: ob.from,
                    nonce: ob.nonce,
                })
            }
            const encoding = proto.Tx.encode(unsignedTx).finish()
            return Hash.hash(encoding)
        } else if (ob instanceof Block || ob instanceof GenesisBlock) {
            return Hash.hash(ob.header.encode())
        } else if (ob instanceof Tx || ob instanceof BaseBlockHeader || ob instanceof BlockHeader || ob instanceof StateNode || ob instanceof Account || ob instanceof GenesisBlockHeader || ob instanceof GenesisTx) {
            return Hash.hash(ob.encode())
        }
        // Danger: typescript claims this line is unreachable, but it is reachable via the slice function
        if (ob === 32) {
            return ob // Here we return the number 32
        }
        throw new Error("Trying to allocate a hash which is not 32 bytes long")
    }
    return Hash.emptyHash
}

export class Hash extends Uint8Array {
    public static readonly emptyHash = blake2b(32).digest()

    public static hash(ob: Uint8Array | string): Uint8Array {
        // Consensus Critical
        typeof ob === "string" ? ob = Buffer.from(ob) : ob = ob
        return blake2b(32).update(ob).digest()
    }

    public static decode(str: string): Hash {
        return new Hash(Base58.decode(str))
    }

    constructor(ob?: Tx | Block | GenesisBlockHeader | BlockHeader | string | SignedTx | GenesisTx | GenesisSignedTx | StateNode | Account | Uint8Array | Buffer) {
        // Consensus Critical
        super(toUint8Array(ob))
    }

    public toString(): string {
        return Base58.encode(this)
    }

    public toHex() {
        return Buffer.from(this as Uint8Array as Buffer).toString("hex")
    }

    public toBuffer(): Buffer {
        // Consensus Critical
        return Buffer.from(this as Uint8Array as Buffer)
    }

    public equals(other: ArrayLike<number>): boolean {
        // Consensus Critical
        if (this.length !== other.length) { return false }
        for (let i = 0; i < other.length; i++) {
            if (this[i] !== other[i]) {
                return false
            }
        }
        return true
    }
}
