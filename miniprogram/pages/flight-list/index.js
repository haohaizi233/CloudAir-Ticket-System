const db = wx.cloud.database()
const _ = db.command

Page({
  data: {
    flightList: [],
    loading: true,
    displayDate: '',
    displayRoute: '',
    displayKeyword: '',
    searchParams: {},
    sortBy: 'default', // default / priceAsc / priceDesc / timeAsc
    hotRoutes: [
      { from: '北京', to: '上海' },
      { from: '成都', to: '三亚' },
      { from: '广州', to: '昆明' },
      { from: '深圳', to: '杭州' }
    ],
    favorites: [],
    showFilter: false,
    filterPriceRange: 'all', // all / low / mid / high
    filterTimeRange: 'all', // all / morning / afternoon / evening
    filterOnlyAvailable: false, // 只看有票
    allFlightList: [], // 保存未筛选的完整列表
    showDetailModal: false,
    detailFlight: {},
    compareMode: false,
    compareList: [],
    showCompareModal: false,
    showPriceAlertModal: false,
    priceAlertFlight: {},
    priceAlertTarget: '',
    priceAlerts: [],
    showMultiDateCompare: false,
    multiDatePrices: []
  },

  onLoad(options) {
    console.log('原始参数:', options)
    const clean = (str) => (str && str !== 'undefined' && str !== 'null') ? decodeURIComponent(str) : '';
    
    const params = {
      from: clean(options.from),
      to: clean(options.to),
      date: clean(options.date),
      keyword: clean(options.keyword)
    }

    this.setData({ searchParams: params })
    this.generateTitle(params)
    this.getFlights(params)
    // 加载收藏列表
    this.loadFavorites()
    // 加载价格提醒
    this.loadPriceAlerts()
  },

  generateTitle(params) {
    let routeText = '所有航线'
    if (params.from && params.to) {
      routeText = `${params.from} ➝ ${params.to}`
    } else if (params.from) {
      routeText = `${params.from} 出发`
    } else if (params.to) {
      routeText = `到达 ${params.to}`
    } else if (params.keyword) {
      routeText = '搜索结果'
    }
    this.setData({
      displayDate: params.date || '日期不限',
      displayRoute: routeText,
      displayKeyword: params.keyword
    })
    // 设置导航栏标题
    wx.setNavigationBarTitle({ title: routeText })
  },

  getFlights(params, isRefresh = false) {
    if (!isRefresh) {
      wx.showLoading({ title: '正在搜寻...' })
    }
    const basicConditions = {}
    if (params.date) {
      basicConditions.dept_time = db.RegExp({ regexp: '^' + params.date, options: 'i' })
    }
    if (params.from) {
      basicConditions.origin = db.RegExp({ regexp: params.from, options: 'i' })
    }
    if (params.to) {
      basicConditions.dest = db.RegExp({ regexp: params.to, options: 'i' })
    }
    let finalQuery = basicConditions
    if (params.keyword) {
      const searchKey = params.keyword.trim()
      const keyReg = db.RegExp({ regexp: searchKey, options: 'i' })
      finalQuery = _.and([
        basicConditions,
        _.or([
          { flight_no: keyReg },  
          { plane_type: keyReg }  
        ])
      ])
    }
    console.log('最终查询条件:', finalQuery)
    const MAX_LIMIT = 20
    db.collection('flights')
      .where(finalQuery)
      .count()
      .then(countRes => {
        const total = countRes.total
        const batchTimes = Math.ceil(total / MAX_LIMIT)
        if (batchTimes === 0) {
          this.setData({ flightList: [], loading: false })
          if (isRefresh) {
            wx.stopPullDownRefresh()
            wx.showToast({ title: '已刷新', icon: 'success', duration: 1000 })
          } else {
            wx.hideLoading()
            wx.showToast({ title: '未找到相关航班', icon: 'none' })
          }
          return
        }
        const allResults = []
        for (let i = 0; i < batchTimes; i++) {
          const p = db.collection('flights')
            .where(finalQuery)
            .skip(i * MAX_LIMIT)
            .limit(MAX_LIMIT)
            .get()
          allResults.push(p)
        }
        Promise.all(allResults).then(results => {
          let allData = []
          results.forEach(res => { allData = allData.concat(res.data) })
          const formattedList = allData.map(item => {
            const fullDeptTime = item.dept_time || ''
            const dateStr = fullDeptTime.split(' ')[0]
            const timeStr = fullDeptTime.split(' ')[1] || '--:--'
            let arrTimeStr = '--:--'
            if (item.arr_time) {
               arrTimeStr = item.arr_time.includes(' ') ? item.arr_time.split(' ')[1] : item.arr_time
            } else {
               arrTimeStr = '待定'
            }
            // 计算飞行时长
            let duration = ''
            if (timeStr !== '--:--' && arrTimeStr !== '--:--' && arrTimeStr !== '待定') {
              const [dh, dm] = timeStr.split(':').map(Number)
              const [ah, am] = arrTimeStr.split(':').map(Number)
              let totalMin = (ah * 60 + am) - (dh * 60 + dm)
              if (totalMin < 0) totalMin += 24 * 60 // 跨天
              const hours = Math.floor(totalMin / 60)
              const mins = totalMin % 60
              duration = hours > 0 ? `${hours}h${mins > 0 ? mins + 'm' : ''}` : `${mins}m`
            }
            // 生成准点率（基于航班号哈希，同一航班号结果固定）
            let onTimeRate = 85
            let stopCity = ''
            let delayRisk = 'low'
            let delayMinutes = 0
            let score = 0
            let onTimeClass = 'on-time-mid'
            let scoreClass = 'mid'
            if (item.flight_no) {
              let hash = 0
              for (let i = 0; i < item.flight_no.length; i++) {
                hash = ((hash << 5) - hash) + item.flight_no.charCodeAt(i)
                hash |= 0
              }
              onTimeRate = 60 + Math.abs(hash) % 35 // 60-94之间
              // 约30%的航班有经停
              const stopCities = ['西安', '武汉', '郑州', '长沙', '重庆', '南京', '合肥', '贵阳', '南昌', '太原']
              if (Math.abs(hash) % 10 < 3) {
                stopCity = stopCities[Math.abs(hash >> 4) % stopCities.length]
              }
              // 延误预测（基于航班号和日期）
              const delayHash = Math.abs(hash >> 8) % 100
              if (delayHash < 10) {
                delayRisk = 'high'
                delayMinutes = 30 + delayHash % 60
              } else if (delayHash < 30) {
                delayRisk = 'medium'
                delayMinutes = 10 + delayHash % 20
              }
              // 综合评分（基于准点率、延误风险、价格竞争力）
              score = onTimeRate * 0.4
              if (delayRisk === 'low') score += 30
              else if (delayRisk === 'medium') score += 15
              else score += 5
              // 价格竞争力（与列表最低价比较，后面会调整）
              score += 20 // 基础分
              score = Math.min(100, Math.round(score))
              // 预计算 WXML 中需要的类名（避免在模板中使用 >= 等符号）
              onTimeClass = onTimeRate >= 90 ? 'on-time-high' : onTimeRate >= 70 ? 'on-time-mid' : 'on-time-low'
              scoreClass = score >= 80 ? 'high' : score >= 60 ? 'mid' : 'low'
            }
            return {
                  ...item,
                  simple_date: dateStr,
                  simple_dept_time: timeStr,
                  simple_arr_time: arrTimeStr,
                  duration,
                  onTimeRate,
                  stopCity,
                  delayRisk,
                  delayMinutes,
                  score,
                  onTimeClass,
                  scoreClass
                }
          })
          this.setData({
            flightList: formattedList,
            allFlightList: formattedList,
            loading: false
          })
          // 更新收藏和对比状态标记
          this.updateItemFlags()
          // 应用当前排序
          this.applySort()
          // 查询各航班余票数
          this.loadSeatCounts(formattedList)
          if (isRefresh) {
            wx.stopPullDownRefresh()
            wx.showToast({ title: '已刷新', icon: 'success', duration: 1000 })
          } else {
            wx.hideLoading()
          }
          if (formattedList.length === 0) {
            wx.showToast({ title: '未找到相关航班', icon: 'none' })
          }
        })
      }).catch(err => {
        console.error('查询失败', err)
        this.setData({ loading: false, flightList: [], allFlightList: [] })
        if (isRefresh) {
          wx.stopPullDownRefresh()
          wx.showToast({ title: '刷新失败，请重试', icon: 'none' })
        } else {
          wx.hideLoading()
          wx.showToast({ title: '查询出错，请检查网络', icon: 'none' })
        }
      })
  },

  // 查询各航班余票数
  loadSeatCounts(flightList) {
    if (!flightList || flightList.length === 0) return
    const flightIds = flightList.map(f => f._id)
    const MAX_LIMIT = 20
    // 查询所有相关航班的座位
    db.collection('seats').where({
      flight_id: _.in(flightIds)
    }).count().then(countRes => {
      const total = countRes.total
      if (total === 0) return
      const batchTimes = Math.ceil(total / MAX_LIMIT)
      const allResults = []
      for (let i = 0; i < batchTimes; i++) {
        allResults.push(
          db.collection('seats').where({
            flight_id: _.in(flightIds)
          }).skip(i * MAX_LIMIT).limit(MAX_LIMIT).get()
        )
      }
      return Promise.all(allResults)
    }).then(results => {
      if (!results) return
      let allSeats = []
      results.forEach(res => { allSeats = allSeats.concat(res.data) })
      // 按航班分组统计
      const seatMap = {}
      allSeats.forEach(seat => {
        if (!seatMap[seat.flight_id]) {
          seatMap[seat.flight_id] = { total: 0, available: 0 }
        }
        seatMap[seat.flight_id].total++
        if (seat.status === 0) {
          seatMap[seat.flight_id].available++
        }
      })
      // 合并到航班列表
      const updatedList = this.data.flightList.map(flight => {
        const info = seatMap[flight._id]
        return {
          ...flight,
          seatTotal: info ? info.total : 0,
          seatAvailable: info ? info.available : 0
        }
      })
      // 标记最低价
      const minPrice = Math.min(...updatedList.map(f => f.price))
      updatedList.forEach(f => {
        f.isLowestPrice = (f.price === minPrice && updatedList.length > 1)
        // 预计算WXML中需要的布尔属性（避免在模板中使用 > 等比较运算符）
        f.seatLow = f.seatAvailable <= 5 && f.seatAvailable > 0
        f.seatSoldOut = f.seatAvailable === 0
        f.hasSeats = f.seatTotal > 0
        f.hasDelayRisk = f.delayRisk && f.delayRisk !== 'low'
        f.isHighDelay = f.delayRisk === 'high'
        f.isMediumDelay = f.delayRisk === 'medium'
      })
      this.setData({ flightList: updatedList })
    }).catch(err => {
      console.error('查询余票失败', err)
    })
  },

  // 收藏功能
  loadFavorites() {
    const favorites = wx.getStorageSync('flightFavorites') || []
    this.setData({ favorites })
    // 尝试从云端同步
    this.syncFavoritesFromCloud()
  },

  // 更新列表项的 isFav 和 isCompareSelected 标记
  updateItemFlags() {
    const { favorites, compareList, flightList } = this.data
    const updated = flightList.map(item => ({
      ...item,
      isFav: favorites.indexOf(item._id) >= 0,
      isCompareSelected: compareList.some(f => f._id === item._id)
    }))
    this.setData({ flightList: updated })
  },

  // 从云端同步收藏
  syncFavoritesFromCloud() {
    const db = wx.cloud.database()
    db.collection('favorites').where({
      _openid: '{openid}' // 云开发自动替换
    }).get().then(res => {
      if (res.data && res.data.length > 0) {
        const cloudFavs = res.data.map(item => item.flightId)
        const localFavs = wx.getStorageSync('flightFavorites') || []
        // 合并本地和云端收藏
        const merged = [...new Set([...localFavs, ...cloudFavs])]
        wx.setStorageSync('flightFavorites', merged)
        this.setData({ favorites: merged })
      }
    }).catch(() => {
      // 云端同步失败，使用本地数据
    })
  },

  onToggleFavorite(e) {
    const flight = e.currentTarget.dataset.flight
    let favorites = [...this.data.favorites]
    const index = favorites.indexOf(flight._id)
    if (index >= 0) {
      favorites.splice(index, 1)
      wx.showToast({ title: '已取消收藏', icon: 'none', duration: 800 })
      // 同步删除云端
      this.removeFavoriteFromCloud(flight._id)
    } else {
      favorites.push(flight._id)
      wx.showToast({ title: '已收藏', icon: 'success', duration: 800 })
      // 同步添加到云端
      this.addFavoriteToCloud(flight)
    }
    wx.setStorageSync('flightFavorites', favorites)
    this.setData({ favorites })
    this.updateItemFlags()
  },
  addFavoriteToCloud(flight) {
    const db = wx.cloud.database()
    db.collection('favorites').add({
      data: {
        flightId: flight._id,
        flightNo: flight.flight_no,
        origin: flight.origin,
        dest: flight.dest,
        price: flight.price,
        createTime: db.serverDate()
      }
    }).catch(() => {})
  },

  // 从云端删除收藏
  removeFavoriteFromCloud(flightId) {
    const db = wx.cloud.database()
    db.collection('favorites').where({
      flightId: flightId
    }).get().then(res => {
      if (res.data && res.data.length > 0) {
        db.collection('favorites').doc(res.data[0]._id).remove().catch(() => {})
      }
    }).catch(() => {})
  },

  // 加载价格提醒
  loadPriceAlerts() {
    const alerts = wx.getStorageSync('priceAlerts') || []
    this.setData({ priceAlerts: alerts })
  },

  // 打开价格提醒弹窗
  onSetPriceAlert(e) {
    const flight = e.currentTarget.dataset.flight
    // 默认目标价格为当前价格的90%
    const targetPrice = Math.round(flight.price * 0.9)
    this.setData({
      showPriceAlertModal: true,
      priceAlertFlight: flight,
      priceAlertTarget: String(targetPrice)
    })
  },

  // 输入目标价格
  onInputTargetPrice(e) {
    this.setData({ priceAlertTarget: e.detail.value })
  },

  // 确认设置价格提醒
  onConfirmPriceAlert() {
    const { priceAlertFlight, priceAlertTarget, priceAlerts } = this.data
    const targetPrice = parseInt(priceAlertTarget)
    if (!targetPrice || targetPrice <= 0) {
      wx.showToast({ title: '请输入有效价格', icon: 'none' })
      return
    }
    if (targetPrice >= priceAlertFlight.price) {
      wx.showToast({ title: '目标价应低于当前价', icon: 'none' })
      return
    }
    // 检查是否已设置
    const existIndex = priceAlerts.findIndex(a => a.flightId === priceAlertFlight._id)
    if (existIndex >= 0) {
      priceAlerts[existIndex].targetPrice = targetPrice
      wx.showToast({ title: '已更新价格提醒', icon: 'success' })
    } else {
      priceAlerts.push({
        flightId: priceAlertFlight._id,
        flightNo: priceAlertFlight.flight_no,
        origin: priceAlertFlight.origin,
        dest: priceAlertFlight.dest,
        currentPrice: priceAlertFlight.price,
        targetPrice,
        createDate: new Date().toLocaleDateString('zh-CN')
      })
      wx.showToast({ title: '价格提醒已设置', icon: 'success' })
    }
    wx.setStorageSync('priceAlerts', priceAlerts)
    this.setData({ priceAlerts, showPriceAlertModal: false })
  },

  // 关闭价格提醒弹窗
  onClosePriceAlert() {
    this.setData({ showPriceAlertModal: false })
  },

  // 删除价格提醒
  onDeletePriceAlert(e) {
    const index = e.currentTarget.dataset.index
    const alerts = this.data.priceAlerts
    alerts.splice(index, 1)
    wx.setStorageSync('priceAlerts', alerts)
    this.setData({ priceAlerts: alerts })
    wx.showToast({ title: '已删除', icon: 'none', duration: 800 })
  },

  // 显示多日期比价
  onShowMultiDateCompare() {
    const { searchParams, flightList } = this.data
    const basePrice = flightList.length > 0 ? Math.min(...flightList.map(f => f.price)) : 500
    // 生成前后3天的模拟价格
    const now = new Date()
    const multiDatePrices = []
    for (let i = -3; i <= 3; i++) {
      const d = new Date(now.getTime() + i * 86400000)
      const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
      const dayLabel = i === 0 ? '今天' : i === -1 ? '昨天' : i === 1 ? '明天' : `${d.getMonth() + 1}/${d.getDate()}`
      const weekDays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']
      const weekDay = weekDays[d.getDay()]
      // 基于哈希生成价格波动
      const hash = this.hashString(dateStr + (searchParams.from || '') + (searchParams.to || ''))
      const priceOffset = (hash % 200) - 100
      const price = Math.max(200, basePrice + priceOffset)
      const isToday = i === 0
      const isLowest = price <= basePrice
      const priceClass = price < basePrice ? 'price-lower' : price > basePrice ? 'price-higher' : 'price-same'
      multiDatePrices.push({ dateStr, dayLabel, weekDay, price, isToday, isLowest, priceClass })
    }
    this.setData({ showMultiDateCompare: true, multiDatePrices })
  },

  // 关闭多日期比价
  onCloseMultiDateCompare() {
    this.setData({ showMultiDateCompare: false })
  },

  // 选择比价日期
  onSelectCompareDate(e) {
    const dateStr = e.currentTarget.dataset.date
    this.setData({ showMultiDateCompare: false })
    // 重新搜索该日期的航班
    wx.redirectTo({
      url: `/pages/flight-list/index?from=${encodeURIComponent(this.data.searchParams.from || '')}&to=${encodeURIComponent(this.data.searchParams.to || '')}&date=${encodeURIComponent(dateStr)}`
    })
  },

  onBook(e) {
    const flight = e.currentTarget.dataset.flight
    const flightStr = JSON.stringify(flight)
    wx.navigateTo({
      url: `/pages/seat-select/index?flight=${encodeURIComponent(flightStr)}`
    })
  },

  // 点击航班卡片查看详情
  onFlightDetail(e) {
    const flight = e.currentTarget.dataset.flight
    // 生成航班动态数据
    const flightDynamics = this.generateFlightDynamics(flight)
    this.setData({ showDetailModal: true, detailFlight: flight, flightDynamics })
  },

  // 生成航班动态追踪数据
  generateFlightDynamics(flight) {
    const now = new Date()
    const deptTime = flight.simple_dept_time || '08:00'
    const arrTime = flight.simple_arr_time || '11:00'
    const [dh, dm] = deptTime.split(':').map(Number)
    const [ah, am] = arrTime.split(':').map(Number)
    const deptMinutes = dh * 60 + dm
    const arrMinutes = ah * 60 + am
    const nowMinutes = now.getHours() * 60 + now.getMinutes()
    const flightDate = flight.simple_date || ''
    const isToday = flightDate === `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`

    // 航班阶段
    let currentPhase = 'scheduled'
    if (isToday) {
      if (nowMinutes < deptMinutes - 45) currentPhase = 'scheduled'
      else if (nowMinutes < deptMinutes - 15) currentPhase = 'checkin'
      else if (nowMinutes < deptMinutes) currentPhase = 'boarding'
      else if (nowMinutes < deptMinutes + 10) currentPhase = 'departed'
      else if (nowMinutes < arrMinutes - 20) currentPhase = 'cruising'
      else if (nowMinutes < arrMinutes) currentPhase = 'descending'
      else currentPhase = 'arrived'
    } else if (flightDate && new Date(flightDate) < new Date(now.getFullYear(), now.getMonth(), now.getDate())) {
      currentPhase = 'arrived'
    }

    const phases = [
      { key: 'scheduled', label: '计划起飞', time: deptTime, desc: '航班计划中', done: false, current: false },
      { key: 'checkin', label: '值机开放', time: `${String(Math.floor((deptMinutes - 45) / 60)).padStart(2, '0')}:${String((deptMinutes - 45) % 60).padStart(2, '0')}`, desc: '提前45分钟值机', done: false, current: false },
      { key: 'boarding', label: '开始登机', time: `${String(Math.floor((deptMinutes - 15) / 60)).padStart(2, '0')}:${String((deptMinutes - 15) % 60).padStart(2, '0')}`, desc: '请前往登机口', done: false, current: false },
      { key: 'departed', label: '已起飞', time: deptTime, desc: '航班已起飞', done: false, current: false },
      { key: 'cruising', label: '巡航中', time: '', desc: '飞行平稳', done: false, current: false },
      { key: 'arrived', label: '已到达', time: arrTime, desc: '航班已到达', done: false, current: false }
    ]

    const phaseOrder = ['scheduled', 'checkin', 'boarding', 'departed', 'cruising', 'arrived']
    const currentIdx = phaseOrder.indexOf(currentPhase)
    phases.forEach((p, i) => {
      if (i < currentIdx) { p.done = true }
      else if (i === currentIdx) { p.current = true }
    })

    // 天气信息（基于城市哈希模拟）
    const weatherOptions = ['晴', '多云', '阴', '小雨', '大风']
    const tempBase = 15 + Math.floor(Math.abs(this.hashString(flight.origin || '')) % 20)
    const destTemp = 15 + Math.floor(Math.abs(this.hashString(flight.dest || '')) % 20)
    const originWeather = weatherOptions[Math.abs(this.hashString(flight.origin || '')) % weatherOptions.length]
    const destWeather = weatherOptions[Math.abs(this.hashString(flight.dest || '')) % weatherOptions.length]

    // 历史延误数据
    const avgDelay = flight.delayRisk === 'high' ? 25 : flight.delayRisk === 'medium' ? 12 : 5
    const recentDelays = []
    for (let i = 0; i < 5; i++) {
      const hash = this.hashString(flight.flight_no + i)
      const delay = Math.abs(hash) % (avgDelay * 2)
      const barClass = delay > 30 ? 'delay-high' : delay > 15 ? 'delay-mid' : 'delay-low'
      recentDelays.push({ delay, barClass })
    }

    return {
      currentPhase,
      phases,
      originWeather: { text: originWeather, temp: tempBase },
      destWeather: { text: destWeather, temp: destTemp },
      avgDelay,
      recentDelays,
      isToday
    }
  },

  // 简单字符串哈希
  hashString(str) {
    let hash = 0
    for (let i = 0; i < str.length; i++) {
      hash = ((hash << 5) - hash) + str.charCodeAt(i)
      hash |= 0
    }
    return hash
  },

  closeDetailModal() {
    this.setData({ showDetailModal: false })
  },

  onBookFromDetail(e) {
    const flight = e.currentTarget.dataset.flight
    this.setData({ showDetailModal: false })
    this.onBook({ currentTarget: { dataset: { flight } } })
  },

  // 切换排序方式
  onSortChange(e) {
    const sortBy = e.currentTarget.dataset.sort
    this.setData({ sortBy })
    this.applySort()
  },

  // 切换筛选面板
  onToggleFilter() {
    this.setData({ showFilter: !this.data.showFilter })
  },

  // 选择价格区间
  onFilterPrice(e) {
    const filterPriceRange = e.currentTarget.dataset.range
    this.setData({ filterPriceRange })
    this.applyFilter()
  },

  // 选择时间段
  onFilterTime(e) {
    const filterTimeRange = e.currentTarget.dataset.range
    this.setData({ filterTimeRange })
    this.applyFilter()
  },

  // 切换只看有票
  onToggleOnlyAvailable() {
    this.setData({ filterOnlyAvailable: !this.data.filterOnlyAvailable })
    this.applyFilter()
  },

  // 重置筛选
  onResetFilter() {
    this.setData({ filterPriceRange: 'all', filterTimeRange: 'all', filterOnlyAvailable: false })
    this.setData({ flightList: this.data.allFlightList })
    this.applySort()
  },

  // 应用筛选
  applyFilter() {
    let list = [...this.data.allFlightList]
    // 价格区间筛选
    if (this.data.filterPriceRange !== 'all') {
      const prices = list.map(f => f.price)
      const minP = Math.min(...prices)
      const maxP = Math.max(...prices)
      const range = (maxP - minP) / 3
      switch (this.data.filterPriceRange) {
        case 'low':
          list = list.filter(f => f.price <= minP + range)
          break
        case 'mid':
          list = list.filter(f => f.price > minP + range && f.price <= minP + range * 2)
          break
        case 'high':
          list = list.filter(f => f.price > minP + range * 2)
          break
      }
    }
    // 时间段筛选
    if (this.data.filterTimeRange !== 'all') {
      list = list.filter(f => {
        const time = f.simple_dept_time || ''
        const hour = parseInt(time.split(':')[0]) || 0
        switch (this.data.filterTimeRange) {
          case 'morning': return hour >= 6 && hour < 12
          case 'afternoon': return hour >= 12 && hour < 18
          case 'evening': return hour >= 18 || hour < 6
          default: return true
        }
      })
    }
    // 只看有票
    if (this.data.filterOnlyAvailable) {
      list = list.filter(f => f.seatAvailable > 0)
    }
    this.setData({ flightList: list })
    this.applySort()
  },

  // 应用排序
  applySort() {
    let list = [...this.data.flightList]
    switch (this.data.sortBy) {
      case 'priceAsc':
        list.sort((a, b) => a.price - b.price)
        break
      case 'priceDesc':
        list.sort((a, b) => b.price - a.price)
        break
      case 'timeAsc':
        list.sort((a, b) => (a.simple_dept_time || '').localeCompare(b.simple_dept_time || ''))
        break
      default:
        break
    }
    this.setData({ flightList: list })
  },

  onGoHome() {
    wx.navigateBack({
      fail: () => {
        wx.switchTab({ url: '/pages/index/index' })
      }
    })
  },

  // 重新搜索
  onReSearch() {
    wx.navigateBack({
      fail: () => {
        wx.switchTab({ url: '/pages/index/index' })
      }
    })
  },

  // 点击热门航线推荐
  onHotRoute(e) {
    const { from, to } = e.currentTarget.dataset
    const params = {
      from,
      to,
      date: this.data.searchParams.date || '',
      keyword: ''
    }
    this.setData({ searchParams: params, sortBy: 'default' })
    this.generateTitle(params)
    this.getFlights(params)
  },

  // 下拉刷新
  onPullDownRefresh() {
    if (this.data.searchParams) {
      this.setData({ sortBy: 'default' })
      this.getFlights(this.data.searchParams, true)
    } else {
      wx.stopPullDownRefresh()
    }
  },

  // 分享给好友
  onShareAppMessage() {
    const { searchParams, displayRoute } = this.data
    return {
      title: `${displayRoute} - 航班查询`,
      path: `/pages/flight-list/index?from=${encodeURIComponent(searchParams.from || '')}&to=${encodeURIComponent(searchParams.to || '')}&date=${searchParams.date || ''}&keyword=${encodeURIComponent(searchParams.keyword || '')}`
    }
  },

  // 切换对比模式
  onToggleCompare() {
    this.setData({ compareMode: !this.data.compareMode, compareList: [] })
  },

  // 添加/移除对比航班
  onToggleCompareItem(e) {
    const flight = e.currentTarget.dataset.flight
    let compareList = [...this.data.compareList]
    const index = compareList.findIndex(f => f._id === flight._id)
    if (index >= 0) {
      compareList.splice(index, 1)
    } else {
      if (compareList.length >= 3) {
        wx.showToast({ title: '最多对比3个航班', icon: 'none' })
        return
      }
      compareList.push(flight)
    }
    this.setData({ compareList })
    this.updateItemFlags()
  },

  // 显示对比结果
  onShowCompare() {
    if (this.data.compareList.length < 2) {
      wx.showToast({ title: '请选择至少2个航班', icon: 'none' })
      return
    }
    this.setData({ showCompareModal: true })
  },

  // 关闭对比弹窗
  onCloseCompare() {
    this.setData({ showCompareModal: false })
  },

  // 从对比弹窗预订
  onBookFromCompare(e) {
    const flight = e.currentTarget.dataset.flight
    this.setData({ showCompareModal: false, compareMode: false, compareList: [] })
    this.onBook({ currentTarget: { dataset: { flight } } })
  }
})