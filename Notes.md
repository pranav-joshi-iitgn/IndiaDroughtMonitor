# `India_Drought_Area_Timeseries.txt`

* year
* month
* day of month
* area under normal
* ...
* area under exceptional drought


## `drought_persist_7day.txt`

Prediction for drought condition after 7 days

| code | current | after 7 days |
| --- | ------- | ----------- |
| 0 | no drought | no | 
| 1 | no | yes |
| 2 | yes | no | 
| 3 | yes | yes |

## `SPI_7day.txt` (prediction)

lat, long, SPI (Z-score) value

average rainfall over next 7 days, Z-scored over last few years. 

## Future file : `P_mag_7day.txt`

lat, long, total rainfall

## `SPI_observed.txt` (statistic)

for last 1 (or more) months. 

lat, long, 1 month avg z score




