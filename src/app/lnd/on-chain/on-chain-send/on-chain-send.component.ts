import { Component, Input, OnInit, OnDestroy } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { Subject } from 'rxjs';
import { takeUntil, take } from 'rxjs/operators';
import { Store } from '@ngrx/store';

import { SelNodeChild, GetInfoRoot } from '../../../shared/models/RTLconfig';
import { GetInfo, Balance, ChannelsTransaction, AddressType } from '../../../shared/models/lndModels';
import { CURRENCY_UNITS, CurrencyUnitEnum, CURRENCY_UNIT_FORMATS } from '../../../shared/models/enums';
import { RTLConfiguration } from '../../../shared/models/RTLconfig';
import { CommonService } from '../../../shared/services/common.service';
import { LoggerService } from '../../../shared/services/logger.service';
import * as sha256 from 'sha256';

import { RTLEffects } from '../../../store/rtl.effects';
import * as RTLActions from '../../../store/rtl.actions';
import * as fromRTLReducer from '../../../store/rtl.reducers';

@Component({
  selector: 'rtl-on-chain-send',
  templateUrl: './on-chain-send.component.html',
  styleUrls: ['./on-chain-send.component.scss']
})
export class OnChainSendComponent implements OnInit, OnDestroy {
  @Input() sweepAll = false;
  private _sweepBalance = 0;
  get sweepBalance() {
    return this._sweepBalance;
  }
  @Input() set sweepBalance(bal) {
    this._sweepBalance = bal;
    this.transaction.amount = this._sweepBalance;
  }
  public sweepAllHint = 'Sending all your funds';
  public selNode: SelNodeChild = {};
  public appConfig: RTLConfiguration;
  public nodeData: GetInfoRoot;
  public addressTypes = [];
  public flgLoadingWallet: Boolean | 'error' = true;
  public selectedAddress: AddressType = {};
  public blockchainBalance: Balance = {};
  public information: GetInfo = {};
  public newAddress = '';
  public transaction: ChannelsTransaction = {};
  public transTypes = [{id: '1', name: 'Target Confirmation Blocks'}, {id: '2', name: 'Fee'}];
  public selTransType = '1';
  public amountUnits = CURRENCY_UNITS;
  public selAmountUnit = CURRENCY_UNITS[0];
  public currConvertorRate = {};
  public unitConversionValue = 0;
  public currencyUnitFormats = CURRENCY_UNIT_FORMATS;
  private unSubs: Array<Subject<void>> = [new Subject(), new Subject(), new Subject(), new Subject(), new Subject()];

  constructor(private logger: LoggerService, private store: Store<fromRTLReducer.RTLState>, private rtlEffects: RTLEffects, private commonService: CommonService, private decimalPipe: DecimalPipe) {}

  ngOnInit() {
    this.store.select('root')
    .pipe(takeUntil(this.unSubs[0]))
    .subscribe((rootStore) => {
      this.amountUnits = rootStore.selNode.settings.currencyUnits;
      this.appConfig = rootStore.appConfig;
      this.nodeData = rootStore.nodeData;
      this.logger.info(rootStore);
    });
  }

  onSendFunds() {
    if(this.transaction.amount && this.selAmountUnit !== CurrencyUnitEnum.SATS) {
      this.commonService.convertCurrency(this.transaction.amount, this.selAmountUnit === this.amountUnits[2] ? CurrencyUnitEnum.OTHER : this.selAmountUnit, this.amountUnits[2])
      .pipe(takeUntil(this.unSubs[1]))
      .subscribe(data => {
        this.transaction.amount = parseInt(data[CurrencyUnitEnum.SATS]);
        this.confirmSend();
      });
    } else {
      this.confirmSend();
    }
    this.rtlEffects.closeConfirm
    .pipe(takeUntil(this.unSubs[2]))
    .subscribe(confirmRes => {
      if (confirmRes) {
        if (this.transaction.sendAll && !+this.appConfig.sso.rtlSSO) {
          this.store.dispatch(new RTLActions.OpenConfirmation({ width: '70%', data:
            {type: 'CONFIRM', titleMessage: 'Enter Login Password', noBtnText: 'Cancel', yesBtnText: 'Authorize', flgShowInput: true, getInputs: [
              {placeholder: 'Enter Login Password', inputType: 'password', inputValue: ''}
            ]}
          }));
          this.rtlEffects.closeConfirm
          .pipe(takeUntil(this.unSubs[3]))
          .subscribe(pwdConfirmRes => {
            if (pwdConfirmRes) {
              const pwd = pwdConfirmRes[0].inputValue;
              this.store.dispatch(new RTLActions.IsAuthorized(sha256(pwd)));
              this.rtlEffects.isAuthorizedRes
              .pipe(take(1))
              .subscribe(authRes => {
                if (authRes !== 'ERROR') {
                  this.dispatchToSendFunds();
                }
              });
            }
          });
        } else {
          this.dispatchToSendFunds();
        }
      }
    });
  }

  confirmSend() {
    const confirmationMsg = {
      'BTC Address': this.transaction.address,
    };
    if (this.sweepAll) {
      confirmationMsg['Sweep All'] = 'True';
      this.transaction.sendAll = true;
    } else {
      confirmationMsg['Amount (' + this.nodeData.smaller_currency_unit + ')'] = this.transaction.amount;
      this.transaction.sendAll = false;
    }
    if (this.selTransType === '1') {
      delete this.transaction.fees;
      confirmationMsg['Target Confirmation Blocks'] = this.transaction.blocks;
    } else {
      delete this.transaction.blocks;
      confirmationMsg['Fee (' + this.nodeData.smaller_currency_unit + '/Byte)'] = this.transaction.fees;
    }
    this.store.dispatch(new RTLActions.OpenConfirmation({ width: '70%', data:
      {type: 'CONFIRM', message: JSON.stringify(confirmationMsg), noBtnText: 'Cancel', yesBtnText: 'Send'}
    }));
  }

  dispatchToSendFunds() {
    this.store.dispatch(new RTLActions.OpenSpinner('Sending Funds...'));
    this.store.dispatch(new RTLActions.SetChannelTransaction(this.transaction));
    this.transaction = {};
  }

  get invalidValues(): boolean {
    return (undefined === this.transaction.address || this.transaction.address === '')
        || (undefined === this.transaction.amount || this.transaction.amount <= 0)
        || (this.selTransType === '1' && (undefined === this.transaction.blocks || this.transaction.blocks <= 0))
        || (this.selTransType === '2' && (undefined === this.transaction.fees || this.transaction.fees <= 0));
  }

  resetData() {
    this.selTransType = '1';      
    if (this.sweepAll) {
      this.transaction.address = '';
      this.transaction.blocks = null;
      this.transaction.fees = null;
    } else {
      this.transaction = {};
    }
  }

  onAmountUnitChange(event: any) {
    let self = this;
    let prevSelectedUnit = (this.sweepAll) ? CurrencyUnitEnum.SATS : (this.selAmountUnit === this.amountUnits[2]) ? CurrencyUnitEnum.OTHER : this.selAmountUnit;
    let currSelectedUnit = event.value === this.amountUnits[2] ? CurrencyUnitEnum.OTHER : event.value;
    if(this.transaction.amount && this.selAmountUnit !== event.value) {
      let amount = (this.sweepAll) ? this.sweepBalance : this.transaction.amount;
      this.commonService.convertCurrency(amount, prevSelectedUnit, this.amountUnits[2])
      .pipe(takeUntil(this.unSubs[4]))
      .subscribe(data => {
        self.transaction.amount = +self.decimalPipe.transform(data[currSelectedUnit], self.currencyUnitFormats[currSelectedUnit]).replace(/,/g, '');
      });
    }
    this.selAmountUnit = event.value;
  }  

  ngOnDestroy() {
    this.unSubs.forEach(completeSub => {
      completeSub.next();
      completeSub.complete();
    });
  }

}
