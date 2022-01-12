// Version: 2.2
// Latest Source: https://github.com/Czarto/Adwords-Scripts/blob/master/device-bid-adjustments.js
//
// This Google Ads Script will incrementally change device bid adjustments
// based on conversion rates using the Campaign's average conversion rate
// as a baseline.
//

/***********

MIT License

Copyright (c) 2016-2021 Alex Czartoryski

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

**********/

var LABEL_PROCESSING = "_processing_device";
var LABEL_PROCESSING_RESOURCE = "";

var BID_INCREMENT = 0.05;       // Value by which to adjust bids
var MIN_CONVERSIONS = 5;       // Minimum conversions needed to adjust bids.
var MAX_BID_ADJUSTMENT = 1.90;  // Do not increase adjustments above this value
var MIN_BID_ADJUSTMENT = 0.10;  // Do not decrease adjustments below this value



function main() {
    initLabels(); // Create Labels

    /*****
      Device performance *should* theoretically not vary over time
      (unless a site redesign has been performed) and so it makes
      most sense to use a relatively long time period (1 year)
      on which to base adjustments.

      Shorter time periods included for reference, but commented out
    *****/

    //setDeviceBidModifier("LAST_7_DAYS");
    //setDeviceBidModifier("LAST_14_DAYS");
    //setDeviceBidModifier("LAST_30_DAYS");
    //setDeviceBidModifier(LAST_90_DAYS(), TODAY());
    setDeviceBidModifier(LAST_YEAR(), TODAY());
    setDeviceBidModifier("ALL_TIME");

    cleanup(); // Remove Labels
}


//
// Set the Processing label
// This keeps track of which bid adjustments have already been processed
// in the case where multiple time-lookback windows are being used
//
function initLabels() {
    checkLabelExists();
    cleanup();

    var itemsToLabel = [AdsApp.campaigns(), AdsApp.shoppingCampaigns()];

    for (i = 0; i < itemsToLabel.length; i++) {
        var iterator = itemsToLabel[i].withCondition("Status = ENABLED").get();

        while (iterator.hasNext()) {
            iterator.next().applyLabel(LABEL_PROCESSING);
        }
    }
}



//
// Create the processing label if it does not exist
//
function checkLabelExists() {
    var labelIterator = AdsApp.labels().withCondition("Name = '" + LABEL_PROCESSING + "'" ).get();

    if( !labelIterator.hasNext()) {
        AdsApp.createLabel(LABEL_PROCESSING, "AdWords Scripts label used to process bids")
    }

    // Get label resource Ids (for beta experience script)
    /* Beta
    var labelIterator = AdsApp.labels().withCondition("Name = '" + LABEL_PROCESSING "'").get();
    if (labelIterator.hasNext()) {
        LABEL_PROCESSING_RESOURCE = labelIterator.next().getResourceName();
        Logger.log(LABEL_PROCESSING_RESOURCE);        } */
}


//
// Remove Processing label
//
function cleanup() {
    var cleanupList = [AdsApp.campaigns(), AdsApp.shoppingCampaigns()];

    for (i = 0; i < cleanupList.length; i++) {
      var iterator = cleanupList[i].withCondition("LabelNames CONTAINS_ANY ['" + LABEL_PROCESSING + "']").get();
  
      while (iterator.hasNext()) {
        iterator.next().removeLabel(LABEL_PROCESSING);
      }
    }
}


//
// Set Device Bids
//
function setDeviceBidModifier(dateRange, dateRangeEnd) {
    var STANDARD = 0;
    var SHOPPING = 1;

    Logger.log('Date Range from ' + dateRange + ' to ' + dateRangeEnd);

    for (i = 0; i < 2; i++) {
        Logger.log('---  ' + (i==STANDARD ? 'Standard Campaigns' : 'Shopping Campaigns'));

        var campaigns = (i==STANDARD ? AdsApp.campaigns() : AdsApp.shoppingCampaigns());
        var campaignIterator = campaigns.forDateRange(dateRange, dateRangeEnd)
            //.withCondition("campaign.status = ENABLED") // Beta Scripts
            //.withCondition("metrics.conversions > " + (MIN_CONVERSIONS-1))
            //.withCondition("campaign.labels CONTAINS ANY ('" + LABEL_PROCESSING_RESOURCE + "')") // Beta Scripts
            .withCondition("Status = ENABLED") // Old Scripts
            .withCondition("Conversions > " + (MIN_CONVERSIONS-1))
            .withCondition("LabelNames CONTAINS_ANY ['" + LABEL_PROCESSING + "']") // Old Scripts
            .get();

        while (campaignIterator.hasNext()) {
            var campaign = campaignIterator.next();

            // Get click and revenue data for the entire campaign
            var report = AdsApp.report(
                "SELECT Clicks, ConversionValue " +
                "FROM CAMPAIGN_PERFORMANCE_REPORT " +
                "WHERE CampaignId = " + campaign.getId() + " " +
                "DURING " + dateRangeToString(dateRange, dateRangeEnd));
          
            var row = report.rows().next();
            var campaignClicks = row['Clicks'];
            var campaignRevenue = row['ConversionValue'].replace(',','');
            var campaignRevenuePerClick = (campaignClicks == 0 ? 0 : campaignRevenue/campaignClicks);

            if( campaignRevenuePerClick > 0 ) {
                // Get clikc and revenue data for each device
                var report = AdsApp.report(
                    "SELECT Device, Clicks, Conversions, ConversionValue " +
                    "FROM CAMPAIGN_PERFORMANCE_REPORT " +
                    "WHERE CampaignId = " + campaign.getId() + " " +
                    "DURING " + dateRangeToString(dateRange, dateRangeEnd));
            
                var reportRows = report.rows();
            
                while(reportRows.hasNext()) {
                    var row = reportRows.next();
                    var device = row['Device'];
                    var clicks = row['Clicks'];
                    var conversions = row['Conversions'];
                    var revenue = row['ConversionValue'].replace(',','');
                    var revenuePerClick = (clicks == 0 ? 0 : revenue/clicks);
                    var deviceTarget;

                    switch(device) {
                        case "Computers": deviceTarget = campaign.targeting().platforms().desktop(); break;
                        case "Mobile devices with full browsers": deviceTarget = campaign.targeting().platforms().mobile(); break;
                        case "Tablets with full browsers": deviceTarget = campaign.targeting().platforms().tablet(); break;
                        default: deviceTarget = null;
                    }

                    if(deviceTarget) {
                        var target = deviceTarget.get().next();
                        var currentBidAdjustment = target.getBidModifier();
                        var targetBidAdjustment = (revenuePerClick / campaignRevenuePerClick);

                        if (Math.abs(currentBidAdjustment - targetBidAdjustment) >= BID_INCREMENT) {
                            if (targetBidAdjustment > currentBidAdjustment && conversions >= MIN_CONVERSIONS) {
                                // Increase adjustment. Only increase bids if sufficient conversions
                                target.setBidModifier(Math.min(currentBidAdjustment + BID_INCREMENT, MAX_BID_ADJUSTMENT));
                            } else {
                                // Decrease adjustment.
                                target.setBidModifier(Math.max(currentBidAdjustment - BID_INCREMENT, MIN_BID_ADJUSTMENT));
                            }
                        }
                    }
                }

                campaign.removeLabel(LABEL_PROCESSING);
            }
        }
    }
}

//
// Date range helper function
// Returns today's date
//
function TODAY() {
    var today = new Date();
    var dd = today.getDate();
    var mm = today.getMonth() + 1; // 0-11
    var yyyy = today.getFullYear();

    return { year: yyyy, month: mm, day: dd };
}

//
// Date range helper functions
// Returns date 90 days ago
//
function LAST_90_DAYS() {
    var date = new Date(); 
    date.setDate(date.getDate() - 90);
    
    var dd = date.getDate();
    var mm = date.getMonth()+1; // 0-11
    var yyyy = date.getFullYear();
  
    return {year: yyyy, month: mm, day: dd};
  }

//
// Date range helper functions
// Returns date 1 year ago
//
function LAST_YEAR() {
    var today = TODAY();

    today.year = today.year - 1;
    return today;
}


//
// Date range helper function - Reports
// Returns a date range that will work in the DURING clause of the reporting query langugae
//
function dateRangeToString(dateRange, dateRangeEnd) {
    if( dateRange == "LAST_7_DAYS" || dateRange == "LAST_14_DAYS" || dateRange == "LAST_30_DAYS" ) {
      return dateRange;
    } else if (dateRange == "ALL_TIME" ) {
      return "20000101," + TODAY().year.toString() + ("0" + TODAY().month).slice(-2) + ("0" + TODAY().day).slice(-2);
    } else {
      return dateRange.year.toString() + ("0" + dateRange.month).slice(-2) + ("0" + dateRange.day).slice(-2) + ","
             + dateRangeEnd.year.toString() + ("0" + dateRangeEnd.month).slice(-2) + ("0" + dateRangeEnd.day).slice(-2);
    }
  }