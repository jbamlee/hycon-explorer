import Long = require("long")
import * as React from "react"
import { Link } from "react-router-dom"
import { IBlock, Rest } from "./restv2"
import { hycontoString } from "./stringUtil"
interface IBlockLineView {
    block: IBlock
    age?: IAge
}
interface IAge {
    diffDate: number
    diffHour: number
    diffMin: number
    diffSec: number
}
export class BlockLine extends React.Component<any, any> {
    public intervalId: any // NodeJS.Timer
    constructor(props: any) {
        super(props)
        this.state = {
            block: props.block,
        }
    }
    public componentWillMount() {
        this.getDiffDate()
    }
    public componentDidMount() {
        this.intervalId = setInterval(() => {
            this.getDiffDate()
        }, 1000)
    }
    public componentWillUnmount() {
        clearInterval(this.intervalId)
    }

    public getDiffDate() {
        let diffDateTime = Date.now() - +this.state.block.blockTimeStamp
        const diffDate = (diffDateTime - diffDateTime % 86400000) / 86400000
        diffDateTime -= diffDate * 86400000
        const diffHour = (diffDateTime - diffDateTime % 3600000) / 3600000
        diffDateTime -= diffHour * 3600000
        const diffMin = (diffDateTime - diffDateTime % 60000) / 60000
        diffDateTime -= diffMin * 60000
        const diffSec = (diffDateTime - diffDateTime % 1000) / 1000
        const tmpBlk = this.state.block
        tmpBlk.age = { diffDate, diffHour, diffMin, diffSec }
        this.setState({ block: tmpBlk })
    }
    public render() {
        if (this.state.block.age === undefined) {
            return < div ></div >
        }
        const totalHyconString = hycontoString(Long.fromString(this.state.block.totalSent), true)
        return (
            <tr>
                <td className="mdl-data-table__cell--non-numeric">
                    <Link to={`/block/${this.state.block.blockhash}`}>
                        {this.state.block.height}
                    </Link>
                </td>
                <td className="mdl-data-table__cell--non-numeric">
                    {this.state.block.age.diffDate > 0
                        ? this.state.block.age.diffDate + " days "
                        : ""}
                    {this.state.block.age.diffHour > 0
                        ? this.state.block.age.diffHour + " hours "
                        : ""}
                    {this.state.block.age.diffMin > 0
                        ? this.state.block.age.diffMin + " minutes"
                        : ""}
                    {this.state.block.age.diffDate === 0 && this.state.block.age.diffHour === 0 && this.state.block.age.diffMin === 0 ?
                        this.state.block.age.diffSec + " seconds" : ""}
                </td>
                <td className="mdl-data-table__cell--numeric" style={{ paddingRight: "10%" }}>{this.state.block.txCount}</td>
                <td className="mdl-data-table__cell--numeric" style={{ paddingRight: "10%" }}>{this.state.block.uncleCount !== undefined ? this.state.block.uncleCount : 0}</td>
                <td className="mdl-data-table__cell--numeric" style={{ paddingRight: "10%" }}>
                    {totalHyconString} HYCON
                </td>
                <td className="mdl-data-table__cell--non-numeric">
                    <Link to={`/address/${this.state.block.miner}`}>
                        {this.state.block.miner}
                    </Link>
                </td>
            </tr>
        )
    }
}
